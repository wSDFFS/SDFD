"""
FastAPI Application - Queue Management System
Tickets stored in RAM only, configuration in MySQL
"""
import os
import io
import time
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from contextlib import asynccontextmanager

import bcrypt
import jwt
import qrcode
from fastapi import FastAPI, HTTPException, Depends, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from sqlalchemy import and_

import socketio
from prometheus_client import Counter, Histogram, Gauge, CONTENT_TYPE_LATEST
from prometheus_client import generate_latest

from db import (
    Base, engine, SessionLocal, get_db,
    User, Structure, Statistics, RateLimitLog, ServiceRecord, init_db
)
from core import queue_engine, Ticket, QueueConfig

# Load environment
from dotenv import load_dotenv
load_dotenv()

# ============================================================================
# LOGGING — Aucun UUID ticket, aucune donnée usager sensible
# ============================================================================

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("queue_system")

# Configuration
JWT_SECRET = os.getenv("JWT_SECRET", "your-super-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION = int(os.getenv("JWT_EXPIRATION", "86400"))  # 24 hours

# Frontend base URL for QR codes and tracking links
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")

# Rate limiting configuration (in-memory)
rate_limit_store: Dict[str, List[float]] = {}

# ============================================================================
# PROMETHEUS METRICS
# ============================================================================

queue_tickets_active = Gauge('queue_tickets_active', 'Active tickets in queue', ['structure_id'])
queue_wait_time_seconds = Histogram('queue_wait_time_seconds', 'Wait time in seconds', ['structure_id'])
queue_service_time_seconds = Histogram('queue_service_time_seconds', 'Service time in seconds', ['structure_id'])
queue_tickets_created_total = Counter('queue_tickets_created_total', 'Total tickets created', ['structure_id'])
queue_tickets_expired_total = Counter('queue_tickets_expired_total', 'Total tickets expired', ['structure_id'])
http_request_duration_ms = Histogram('http_request_duration_ms', 'HTTP request duration in ms', ['method', 'endpoint'])
websocket_connections_active = Gauge('websocket_connections_active', 'Active WebSocket connections')
queue_length_gauge = Gauge('queue_length', 'Current queue length per structure', ['structure_id'])
queue_avg_wait_seconds = Gauge('queue_avg_wait_seconds', 'Average estimated wait time per structure', ['structure_id'])
queue_avg_service_seconds = Gauge('queue_avg_service_seconds', 'Average service time per structure', ['structure_id'])

# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class UserRegister(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class TicketCreate(BaseModel):
    type_index: int = Field(default=0, ge=0)

class TicketUpdateType(BaseModel):
    type_index: int = Field(..., ge=0)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class StructureCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    description: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    alpha: float = Field(default=1.0, ge=0)
    beta: float = Field(default=0.5, ge=0)
    t_ref: int = Field(default=300, ge=60)
    ticket_ttl: int = Field(default=3600, ge=300, le=86400)
    types: Optional[List[Dict]] = None

class StructureUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    description: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None
    alpha: Optional[float] = Field(None, ge=0)
    beta: Optional[float] = Field(None, ge=0)
    t_ref: Optional[int] = Field(None, ge=60)
    ticket_ttl: Optional[int] = Field(None, ge=300, le=86400)
    types: Optional[List[Dict]] = None

class ConfigUpdate(BaseModel):
    alpha: Optional[float] = None
    beta: Optional[float] = None
    t_ref: Optional[int] = None
    ticket_ttl: Optional[int] = None
    types: Optional[List[Dict]] = None

# ============================================================================
# RATE LIMITING
# ============================================================================

def get_client_ip(request: Request) -> str:
    """Get client IP from request"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def check_rate_limit(identifier: str, action: str, max_requests: int, window_seconds: int) -> bool:
    """
    Check if request is within rate limits
    Returns True if allowed, False if rate limited
    """
    now = time.time()
    key = f"{identifier}:{action}"

    if key not in rate_limit_store:
        rate_limit_store[key] = []

    # Remove old entries
    rate_limit_store[key] = [
        t for t in rate_limit_store[key]
        if now - t < window_seconds
    ]

    if len(rate_limit_store[key]) >= max_requests:
        return False

    rate_limit_store[key].append(now)
    return True

def clean_rate_limits():
    """Periodically clean old rate limit entries"""
    now = time.time()
    keys_to_delete = []

    for key in rate_limit_store:
        rate_limit_store[key] = [
            t for t in rate_limit_store[key]
            if now - t < 3600  # Keep last hour
        ]
        if not rate_limit_store[key]:
            keys_to_delete.append(key)

    for key in keys_to_delete:
        del rate_limit_store[key]

# ============================================================================
# AUTHENTICATION
# ============================================================================

def hash_password(password: str) -> str:
    """Hash password with bcrypt"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    """Verify password against hash"""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_jwt_token(user: User) -> str:
    """Create JWT token for user"""
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "name": user.name,
        "structure_id": user.structure_id,
        "exp": datetime.utcnow() + timedelta(seconds=JWT_EXPIRATION),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_jwt_token(token: str) -> Optional[dict]:
    """Verify and decode JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

async def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> User:
    """Get current user from JWT token"""
    auth_header = request.headers.get("Authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = auth_header[7:]
    payload = verify_jwt_token(token)

    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == user_id).first()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return user

async def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """Require admin role"""
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

async def get_agent_user(current_user: User = Depends(get_current_user)) -> User:
    """Require agent or admin role"""
    if current_user.role not in ["ADMIN", "AGENT"]:
        raise HTTPException(status_code=403, detail="Agent access required")
    return current_user

# ============================================================================
# QR CODE HELPERS
# ============================================================================

def generate_qr_png(url: str) -> bytes:
    """
    Generate a QR code PNG image for the given URL.
    Returns raw PNG bytes.
    """
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()

# ============================================================================
# STATISTICS HELPERS
# ============================================================================

def get_or_create_today_stats(db: Session, structure_id: str) -> Statistics:
    """
    Get or create today's Statistics record for a structure.
    Uses UTC date, truncated to day boundary.
    """
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    record = db.query(Statistics).filter(
        and_(
            Statistics.structure_id == structure_id,
            Statistics.date == today
        )
    ).first()
    if not record:
        record = Statistics(
            structure_id=structure_id,
            date=today,
            tickets_created=0,
            tickets_served=0,
            tickets_expired=0,
            avg_wait_time=0.0,
            avg_service_time=0.0,
            max_wait_time=0,
            max_queue_length=0
        )
        db.add(record)
        db.flush()
    return record

# ============================================================================
# WEBSOCKET SERVER
# ============================================================================

sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    namespaces=['/ws/ticket', '/ws/structure', '/ws/display']
)

# Track connections — on ne logue jamais l'UUID ticket
websocket_clients = {}

@sio.event
async def connect(sid, environ, namespace):
    """Handle WebSocket connection"""
    websocket_clients[sid] = {
        "namespace": namespace,
        "connected_at": time.time()
    }
    websocket_connections_active.inc()
    logger.info(f"WebSocket client connected to {namespace}")

@sio.event
async def disconnect(sid):
    """Handle WebSocket disconnection"""
    namespace = websocket_clients.get(sid, {}).get("namespace", "unknown")
    if sid in websocket_clients:
        del websocket_clients[sid]
    websocket_connections_active.dec()
    logger.info(f"WebSocket client disconnected from {namespace}")

@sio.event
async def join_ticket(sid, data):
    """Join a ticket room for position updates"""
    ticket_uuid = data.get("ticket_uuid")
    if ticket_uuid:
        await sio.enter_room(sid, f"ticket_{ticket_uuid}", namespace='/ws/ticket')

@sio.event
async def join_structure(sid, data):
    """Join a structure room for queue updates"""
    structure_id = data.get("structure_id")
    if structure_id:
        await sio.enter_room(sid, f"structure_{structure_id}", namespace='/ws/structure')

@sio.event
async def join_display(sid, data):
    """Join a display room"""
    structure_id = data.get("structure_id")
    if structure_id:
        await sio.enter_room(sid, f"display_{structure_id}", namespace='/ws/display')

async def broadcast_ticket_created(structure_id: str, ticket: Ticket, position: int):
    """Broadcast ticket creation"""
    config = queue_engine.get_config(structure_id)
    avg_wait = queue_engine.get_average_service_time(structure_id)

    data = {
        "ticket": {
            "uuid": ticket.uuid,
            "number": ticket.number,
            "type_index": ticket.type_index,
            "priority_value": ticket.priority_value,
            "type_name": config.types[ticket.type_index]["name"] if ticket.type_index < len(config.types) else "Standard"
        },
        "position": position,
        "estimated_wait": int(position * avg_wait),
        "queue_length": queue_engine.get_queue_length(structure_id)
    }

    await sio.emit('ticket-created', data, room=f"structure_{structure_id}", namespace='/ws/structure')
    await sio.emit('position-update', data, room=f"ticket_{ticket.uuid}", namespace='/ws/ticket')

async def broadcast_ticket_updated(structure_id: str, ticket: Ticket, position: int):
    """Broadcast ticket update"""
    data = {
        "ticket": {
            "uuid": ticket.uuid,
            "number": ticket.number,
            "type_index": ticket.type_index,
            "priority_value": ticket.priority_value
        },
        "position": position
    }

    await sio.emit('ticket-updated', data, room=f"structure_{structure_id}", namespace='/ws/structure')
    await sio.emit('position-update', data, room=f"ticket_{ticket.uuid}", namespace='/ws/ticket')

async def broadcast_ticket_deleted(structure_id: str, ticket_uuid: str):
    """Broadcast ticket deletion"""
    data = {"ticket_uuid": ticket_uuid}

    await sio.emit('ticket-deleted', data, room=f"structure_{structure_id}", namespace='/ws/structure')
    await sio.emit('ticket-cancelled', data, room=f"ticket_{ticket_uuid}", namespace='/ws/ticket')

async def broadcast_queue_updated(structure_id: str):
    """Broadcast full queue update"""
    queue_data = queue_engine.get_queue_for_agent(structure_id)

    await sio.emit('queue-updated', {
        "queue": queue_data,
        "queue_length": len(queue_data)
    }, room=f"structure_{structure_id}", namespace='/ws/structure')

async def broadcast_ticket_called(structure_id: str, ticket: Ticket):
    """Broadcast ticket called"""
    config = queue_engine.get_config(structure_id)
    type_name = config.types[ticket.type_index]["name"] if ticket.type_index < len(config.types) else "Standard"
    data = {
        "ticket": {
            "uuid": ticket.uuid,
            "number": ticket.number,
            "type_index": ticket.type_index,
            "type_name": type_name
        },
        "called_at": int(time.time() * 1000)
    }

    await sio.emit('ticket-called', data, room=f"structure_{structure_id}", namespace='/ws/structure')
    await sio.emit('your-turn', data, room=f"ticket_{ticket.uuid}", namespace='/ws/ticket')
    await sio.emit('display-update', data, room=f"display_{structure_id}", namespace='/ws/display')

async def broadcast_position_alert(structure_id: str, ticket_uuid: str, position: int):
    """Broadcast position alert (when position is 3, 2, 1)"""
    data = {
        "ticket_uuid": ticket_uuid,
        "position": position,
        "message": f"Vous êtes en position {position}"
    }

    await sio.emit('position-alert', data, room=f"ticket_{ticket_uuid}", namespace='/ws/ticket')

# ============================================================================
# BACKGROUND TASKS
# ============================================================================

import asyncio

async def cleanup_expired_tickets():
    """
    Tâche de fond : nettoyage des tickets expirés toutes les 60 secondes.
    Conforme au CDC : purge périodique des tickets hors TTL.
    """
    while True:
        await asyncio.sleep(60)

        for structure_id in list(queue_engine._queues.keys()):
            expired = queue_engine.remove_expired_tickets(structure_id)

            if expired > 0:
                queue_tickets_expired_total.labels(structure_id=structure_id).inc(expired)
                logger.info(f"Structure {structure_id}: {expired} ticket(s) expirés supprimés")

                # --- FIX STATISTIQUES : comptabiliser les tickets expirés ---
                try:
                    db = SessionLocal()
                    stat = get_or_create_today_stats(db, structure_id)
                    stat.tickets_expired += expired
                    db.commit()
                    db.close()
                except Exception as e:
                    logger.warning(f"Erreur mise à jour stats expirés: {e}")

                await broadcast_queue_updated(structure_id)

async def recalculate_scores_and_broadcast():
    """
    Tâche de fond : recalcul explicite des scores et diffusion de la file toutes les 10 secondes.
    Conforme au CDC : recalcul automatique des scores toutes les 10 secondes.
    """
    while True:
        await asyncio.sleep(10)

        for structure_id in list(queue_engine._queues.keys()):
            queue_len = queue_engine.get_queue_length(structure_id)
            if queue_len == 0:
                continue

            # Recalcul explicite des scores — exigence CDC démontrée ici
            queue_engine.recalculate_queue_scores(structure_id)
            logger.debug(f"Structure {structure_id}: scores recalculés ({queue_len} ticket(s))")

            # Diffuse la file après recalcul
            await broadcast_queue_updated(structure_id)

            # Alerte de position pour les tickets en positions 1, 2, 3
            sorted_queue = queue_engine.sort_queue(structure_id)
            for idx, ticket in enumerate(sorted_queue[:3]):
                position = idx + 1
                await broadcast_position_alert(structure_id, ticket.uuid, position)

async def update_metrics():
    """
    Tâche de fond : mise à jour des métriques Prometheus toutes les 5 secondes.
    Alimente les dashboards Grafana temps réel.
    """
    while True:
        await asyncio.sleep(5)

        metrics = queue_engine.get_metrics()

        for structure_id, data in metrics.get("queues", {}).items():
            queue_tickets_active.labels(structure_id=structure_id).set(data["active"])
            queue_length_gauge.labels(structure_id=structure_id).set(data["active"])

            # Temps d'attente estimé moyen (position moyenne × temps de service moyen)
            avg_service = queue_engine.get_average_service_time(structure_id)
            avg_position = (data["active"] + 1) / 2 if data["active"] > 0 else 0
            queue_avg_wait_seconds.labels(structure_id=structure_id).set(avg_position * avg_service)
            queue_avg_service_seconds.labels(structure_id=structure_id).set(avg_service)

        # Nettoyage périodique du rate limit store
        clean_rate_limits()

# ============================================================================
# APPLICATION LIFESPAN
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    init_db()

    # Démarrage automatique des tâches de fond
    asyncio.create_task(cleanup_expired_tickets())
    asyncio.create_task(recalculate_scores_and_broadcast())
    asyncio.create_task(update_metrics())

    logger.info("Queue System démarré — schedulers actifs")

    yield

    # Shutdown
    logger.info("Queue System en cours d'arrêt")

# ============================================================================
# CREATE APPLICATION
# ============================================================================

app = FastAPI(
    title="Queue Management System",
    description="Dynamic queue management with real-time updates",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Socket.IO
socket_app = socketio.ASGIApp(sio, app)

# ============================================================================
# METRICS ENDPOINT
# ============================================================================

from fastapi import Response

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )

# ============================================================================
# PUBLIC API - NO AUTH REQUIRED
# ============================================================================

@app.get("/api/structures/{structure_id}/types")
async def get_structure_types(
    structure_id: str,
    db: Session = Depends(get_db)
):
    """Get queue types for a structure"""
    structure = db.query(Structure).filter(Structure.id == structure_id).first()

    if not structure:
        raise HTTPException(status_code=404, detail="Structure not found")

    import json
    types = json.loads(structure.types_config)

    return {
        "structure_id": structure_id,
        "structure_name": structure.name,
        "types": types
    }

# ============================================================================
# PUBLIC TICKET TRACKING ENDPOINT
# ============================================================================

@app.get("/api/public/tickets/{ticket_uuid}")
async def get_public_ticket_tracking(
    ticket_uuid: str,
    db: Session = Depends(get_db)
):
    """
    Public endpoint for ticket tracking on mobile.
    No authentication required.
    Returns ticket status, position, estimated wait and structure info.
    """
    # Search ticket in all structures (RAM)
    for structure_id in queue_engine._queues:
        ticket = queue_engine.get_ticket(structure_id, ticket_uuid)
        if ticket:
            position = queue_engine.get_position(structure_id, ticket_uuid)
            estimated_wait = queue_engine.get_estimated_wait(structure_id, position) if position else 0
            config = queue_engine.get_config(structure_id)
            type_name = config.types[ticket.type_index]["name"] if ticket.type_index < len(config.types) else "Standard"

            # Get structure name from DB
            structure = db.query(Structure).filter(Structure.id == structure_id).first()
            structure_name = structure.name if structure else structure_id

            people_ahead = (position - 1) if position else 0

            return {
                "ticketUuid": ticket.uuid,
                "ticketNumber": ticket.number,
                "ticketType": type_name,
                "status": "waiting",
                "position": position,
                "peopleAhead": people_ahead,
                "estimatedWait": estimated_wait,
                "structureId": structure_id,
                "structureName": structure_name,
                "trackingUrl": f"{FRONTEND_BASE_URL}/track/{ticket_uuid}"
            }

    # Check if ticket is the currently called ticket (just called, no longer in queue)
    for structure_id in queue_engine._queues:
        last_called = queue_engine._last_called.get(structure_id)
        if last_called and last_called.uuid == ticket_uuid:
            config = queue_engine.get_config(structure_id)
            type_name = config.types[last_called.type_index]["name"] if last_called.type_index < len(config.types) else "Standard"
            structure = db.query(Structure).filter(Structure.id == structure_id).first()
            structure_name = structure.name if structure else structure_id

            return {
                "ticketUuid": last_called.uuid,
                "ticketNumber": last_called.number,
                "ticketType": type_name,
                "status": "called",
                "position": 0,
                "peopleAhead": 0,
                "estimatedWait": 0,
                "structureId": structure_id,
                "structureName": structure_name,
                "trackingUrl": f"{FRONTEND_BASE_URL}/track/{ticket_uuid}"
            }

    # Ticket not found in RAM — expired or already done
    return {
        "ticketUuid": ticket_uuid,
        "ticketNumber": None,
        "ticketType": None,
        "status": "expired",
        "position": None,
        "peopleAhead": None,
        "estimatedWait": None,
        "structureId": None,
        "structureName": None,
        "trackingUrl": f"{FRONTEND_BASE_URL}/track/{ticket_uuid}"
    }

@app.post("/api/structures/{structure_id}/tickets")
async def create_ticket(
    structure_id: str,
    request: Request,
    data: TicketCreate,
    db: Session = Depends(get_db)
):
    """Create a new ticket - Rate limited: 5/minute/IP"""

    # Rate limiting
    client_ip = get_client_ip(request)
    if not check_rate_limit(client_ip, "ticket", max_requests=5, window_seconds=60):
        raise HTTPException(
            status_code=429,
            detail="Too many ticket requests. Please wait."
        )

    # Verify structure exists
    structure = db.query(Structure).filter(
        and_(Structure.id == structure_id, Structure.is_active == True)
    ).first()

    if not structure:
        raise HTTPException(status_code=404, detail="Structure not found or inactive")

    # Update queue engine config from database
    import json
    types = json.loads(structure.types_config)
    queue_engine.set_config(structure_id, {
        "alpha": structure.alpha,
        "beta": structure.beta,
        "t_ref": structure.t_ref,
        "ticket_ttl": structure.ticket_ttl,
        "types": types
    })

    # Create ticket
    ticket = queue_engine.create_ticket(structure_id, data.type_index)
    position = queue_engine.get_position(structure_id, ticket.uuid)

    # Update Prometheus metrics
    queue_tickets_created_total.labels(structure_id=structure_id).inc()
    queue_tickets_active.labels(structure_id=structure_id).inc()

    # --- FIX STATISTIQUES : comptabiliser la création de ticket ---
    try:
        stat = get_or_create_today_stats(db, structure_id)
        stat.tickets_created += 1
        # Update max queue length if needed
        current_length = queue_engine.get_queue_length(structure_id)
        if current_length > stat.max_queue_length:
            stat.max_queue_length = current_length
        db.commit()
    except Exception as e:
        logger.warning(f"Erreur mise à jour stats création ticket: {e}")

    # Broadcast via WebSocket
    await broadcast_ticket_created(structure_id, ticket, position)

    # Get estimated wait — conforme au CDC : estimatedWait = position × averageServiceTime
    avg_wait = queue_engine.get_average_service_time(structure_id)
    estimated_wait = queue_engine.get_estimated_wait(structure_id, position)

    # Build tracking URL
    tracking_url = f"{FRONTEND_BASE_URL}/track/{ticket.uuid}"

    logger.info(f"Structure {structure_id}: ticket #{ticket.number} créé, position {position}")

    return {
        "ticket": {
            "uuid": ticket.uuid,
            "number": ticket.number,
            "type_index": ticket.type_index,
            "priority_value": ticket.priority_value,
            "type_name": types[ticket.type_index]["name"] if ticket.type_index < len(types) else "Standard"
        },
        "position": position,
        "estimated_wait": estimated_wait,
        "average_service_time": int(avg_wait),
        "queue_length": queue_engine.get_queue_length(structure_id),
        "tracking_url": tracking_url
    }

@app.get("/api/tickets/{ticket_uuid}/position")
async def get_ticket_position(
    ticket_uuid: str,
    request: Request
):
    """Get current position of a ticket"""

    # Find ticket across all structures
    for structure_id in queue_engine._queues:
        ticket = queue_engine.get_ticket(structure_id, ticket_uuid)
        if ticket:
            position = queue_engine.get_position(structure_id, ticket_uuid)
            avg_wait = queue_engine.get_average_service_time(structure_id)
            # estimatedWait = position × averageServiceTime (CDC)
            estimated_wait = queue_engine.get_estimated_wait(structure_id, position)

            config = queue_engine.get_config(structure_id)
            type_name = config.types[ticket.type_index]["name"] if ticket.type_index < len(config.types) else "Standard"

            return {
                "ticket": {
                    "uuid": ticket.uuid,
                    "number": ticket.number,
                    "type_index": ticket.type_index,
                    "type_name": type_name
                },
                "position": position,
                "estimated_wait": estimated_wait,
                "average_service_time": int(avg_wait),
                "queue_length": queue_engine.get_queue_length(structure_id)
            }

    return {"position": None, "message": "Ticket not found or already served"}

@app.delete("/api/tickets/{ticket_uuid}")
async def cancel_ticket(ticket_uuid: str):
    """Cancel a ticket"""

    # Find ticket
    for structure_id in list(queue_engine._queues.keys()):
        ticket = queue_engine.get_ticket(structure_id, ticket_uuid)
        if ticket:
            ticket_number = ticket.number
            queue_engine.delete_ticket(structure_id, ticket_uuid)

            queue_tickets_active.labels(structure_id=structure_id).dec()
            await broadcast_ticket_deleted(structure_id, ticket_uuid)
            await broadcast_queue_updated(structure_id)

            logger.info(f"Structure {structure_id}: ticket #{ticket_number} annulé")
            return {"message": "Ticket cancelled"}

    raise HTTPException(status_code=404, detail="Ticket not found")

# ============================================================================
# QR CODE ENDPOINTS
# ============================================================================

@app.get("/api/structures/{structure_id}/qrcode/display")
async def get_display_qrcode(
    structure_id: str,
    db: Session = Depends(get_db)
):
    """
    Génère un QR code PNG pointant vers l'écran d'affichage public de la structure.
    URL cible : {FRONTEND_BASE_URL}/display/{structure_id}
    """
    structure = db.query(Structure).filter(Structure.id == structure_id).first()
    if not structure:
        raise HTTPException(status_code=404, detail="Structure not found")

    url = f"{FRONTEND_BASE_URL}/display/{structure_id}"
    png_bytes = generate_qr_png(url)

    return StreamingResponse(
        io.BytesIO(png_bytes),
        media_type="image/png",
        headers={
            "Content-Disposition": f"inline; filename=display_qr_{structure.name.replace(' ', '_')}.png",
            "Cache-Control": "public, max-age=3600"
        }
    )

@app.get("/api/tickets/{ticket_uuid}/qrcode")
async def get_ticket_qrcode(ticket_uuid: str):
    """
    Génère un QR code PNG pointant vers la page de suivi du ticket usager.
    URL cible : {FRONTEND_BASE_URL}/track/{ticket_uuid}
    Disponible tant que le ticket est en file.
    """
    # Vérifier que le ticket existe
    found = False
    for structure_id in queue_engine._queues:
        if queue_engine.get_ticket(structure_id, ticket_uuid):
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail="Ticket not found or already served")

    url = f"{FRONTEND_BASE_URL}/track/{ticket_uuid}"
    png_bytes = generate_qr_png(url)

    return StreamingResponse(
        io.BytesIO(png_bytes),
        media_type="image/png",
        headers={
            "Content-Disposition": "inline; filename=ticket_qr.png",
            "Cache-Control": "no-store"
        }
    )

@app.get("/api/structures/{structure_id}/qrcode/ticket-form")
async def get_ticket_form_qrcode(
    structure_id: str,
    db: Session = Depends(get_db)
):
    """
    Génère un QR code PNG pointant vers le formulaire de prise de ticket pour la structure.
    URL cible : {FRONTEND_BASE_URL}/structures/{structure_id}/ticket
    Affiché à l'accueil de la structure pour que l'usager scanne et prenne un ticket.
    """
    structure = db.query(Structure).filter(Structure.id == structure_id).first()
    if not structure:
        raise HTTPException(status_code=404, detail="Structure not found")

    url = f"{FRONTEND_BASE_URL}/structures/{structure_id}/ticket"
    png_bytes = generate_qr_png(url)

    return StreamingResponse(
        io.BytesIO(png_bytes),
        media_type="image/png",
        headers={
            "Content-Disposition": f"inline; filename=ticket_form_qr_{structure.name.replace(' ', '_')}.png",
            "Cache-Control": "public, max-age=3600"
        }
    )

# ============================================================================
# AUTHENTICATION API
# ============================================================================

@app.post("/api/auth/register", response_model=TokenResponse)
async def register(
    data: UserRegister,
    request: Request,
    db: Session = Depends(get_db)
):
    """Register a new agent user - Role is always AGENT"""

    # Rate limiting
    client_ip = get_client_ip(request)
    if not check_rate_limit(client_ip, "register", max_requests=3, window_seconds=3600):
        raise HTTPException(
            status_code=429,
            detail="Too many registration attempts"
        )

    # Check if email exists
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create user with AGENT role
    user = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role="AGENT"
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_jwt_token(user)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "structure_id": user.structure_id
        }
    }

@app.post("/api/auth/login", response_model=TokenResponse)
async def login(
    data: UserLogin,
    request: Request,
    db: Session = Depends(get_db)
):
    """Login and get JWT token"""

    # Rate limiting
    email_hash = hashlib.sha256(data.email.encode()).hexdigest()[:16]
    client_ip = get_client_ip(request)
    identifier = f"{client_ip}:{email_hash}"

    if not check_rate_limit(identifier, "login", max_requests=5, window_seconds=300):
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please wait 5 minutes."
        )

    user = db.query(User).filter(User.email == data.email).first()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account is inactive")

    token = create_jwt_token(user)

    logger.info(f"Login réussi pour l'utilisateur (id={user.id}, role={user.role})")

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "structure_id": user.structure_id
        }
    }

# ============================================================================
# QUEUE MANAGEMENT API - REQUIRES AUTH
# ============================================================================

@app.get("/api/structures/{structure_id}/queue")
async def get_structure_queue(
    structure_id: str,
    current_user: User = Depends(get_agent_user)
):
    """Get current queue for a structure"""

    # Check access
    if current_user.role != "ADMIN" and current_user.structure_id != structure_id:
        raise HTTPException(status_code=403, detail="Access denied to this structure")

    queue_data = queue_engine.get_queue_for_agent(structure_id)

    return {
        "queue": queue_data,
        "queue_length": len(queue_data),
        "structure_id": structure_id
    }

@app.get("/api/structures/{structure_id}/current-ticket")
async def get_current_ticket(
    structure_id: str,
    current_user: User = Depends(get_agent_user)
):
    """Get currently served ticket"""

    if current_user.role != "ADMIN" and current_user.structure_id != structure_id:
        raise HTTPException(status_code=403, detail="Access denied to this structure")

    ticket = queue_engine.get_current_ticket(structure_id)

    if not ticket:
        return {"ticket": None}

    config = queue_engine.get_config(structure_id)
    type_name = config.types[ticket.type_index]["name"] if ticket.type_index < len(config.types) else "Standard"

    return {
        "ticket": {
            "uuid": ticket.uuid,
            "number": ticket.number,
            "type_index": ticket.type_index,
            "type_name": type_name
        }
    }

@app.post("/api/structures/{structure_id}/next")
async def call_next_ticket(
    structure_id: str,
    current_user: User = Depends(get_agent_user),
    db: Session = Depends(get_db)
):
    """Call next ticket"""

    # Verify access
    if current_user.role != "ADMIN" and current_user.structure_id != structure_id:
        raise HTTPException(status_code=403, detail="Access denied to this structure")

    # Get next ticket
    ticket = queue_engine.get_next_ticket(structure_id)

    if not ticket:
        return {"message": "Queue is empty", "ticket": None}

    # Calculate wait time for this ticket
    wait_time = (int(time.time() * 1000) - ticket.created_at) / 1000

    # Record metrics
    queue_wait_time_seconds.labels(structure_id=structure_id).observe(wait_time)
    queue_tickets_active.labels(structure_id=structure_id).dec()

    # --- FIX STATISTIQUES : comptabiliser le ticket servi et son temps d'attente ---
    try:
        stat = get_or_create_today_stats(db, structure_id)
        stat.tickets_served += 1
        # Update average wait time (running average)
        if stat.tickets_served > 1:
            stat.avg_wait_time = (
                (stat.avg_wait_time * (stat.tickets_served - 1) + wait_time)
                / stat.tickets_served
            )
        else:
            stat.avg_wait_time = wait_time
        # Update max wait time
        if int(wait_time) > stat.max_wait_time:
            stat.max_wait_time = int(wait_time)
        db.commit()
    except Exception as e:
        logger.warning(f"Erreur mise à jour stats appel ticket: {e}")

    # Broadcast
    await broadcast_ticket_called(structure_id, ticket)
    await broadcast_queue_updated(structure_id)

    # Get config for type name
    config = queue_engine.get_config(structure_id)
    type_name = config.types[ticket.type_index]["name"] if ticket.type_index < len(config.types) else "Standard"

    logger.info(f"Structure {structure_id}: ticket #{ticket.number} appelé")

    return {
        "ticket": {
            "uuid": ticket.uuid,
            "number": ticket.number,
            "type_index": ticket.type_index,
            "type_name": type_name
        },
        "wait_time_seconds": int(wait_time)
    }

@app.post("/api/structures/{structure_id}/complete")
async def complete_service(
    structure_id: str,
    service_time: Optional[float] = None,
    current_user: User = Depends(get_agent_user),
    db: Session = Depends(get_db)
):
    """Mark current service as complete and record service time"""

    # Verify access
    if current_user.role != "ADMIN" and current_user.structure_id != structure_id:
        raise HTTPException(status_code=403, detail="Access denied to this structure")

    current = queue_engine.get_current_ticket(structure_id)

    if not current:
        return {"message": "No active ticket"}

    # Calculate service time if not provided
    if service_time is None:
        service_time = queue_engine.get_average_service_time(structure_id)

    # Record service time in engine (sliding window)
    queue_engine.record_service_time(structure_id, service_time)
    queue_service_time_seconds.labels(structure_id=structure_id).observe(service_time)

    # Store in database for statistics
    record = ServiceRecord(
        structure_id=structure_id,
        service_time=service_time
    )
    db.add(record)

    # --- FIX STATISTIQUES : mettre à jour le temps de service moyen dans Statistics ---
    try:
        stat = get_or_create_today_stats(db, structure_id)
        # Recalculate avg_service_time from ServiceRecord table for accuracy
        from sqlalchemy import func
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        result = db.query(func.avg(ServiceRecord.service_time)).filter(
            and_(
                ServiceRecord.structure_id == structure_id,
                ServiceRecord.created_at >= today
            )
        ).scalar()
        if result is not None:
            stat.avg_service_time = float(result)
        db.commit()
    except Exception as e:
        logger.warning(f"Erreur mise à jour stats service: {e}")

    logger.info(f"Structure {structure_id}: service terminé en {int(service_time)}s")

    return {"message": "Service completed", "service_time": service_time}

@app.patch("/api/tickets/{ticket_uuid}/type")
async def update_ticket_type(
    ticket_uuid: str,
    data: TicketUpdateType,
    current_user: User = Depends(get_agent_user)
):
    """Update ticket type/priority"""

    # Find ticket
    for structure_id in queue_engine._queues:
        ticket = queue_engine.get_ticket(structure_id, ticket_uuid)
        if ticket:
            updated = queue_engine.update_type(structure_id, ticket_uuid, data.type_index)

            if updated:
                position = queue_engine.get_position(structure_id, ticket_uuid)
                await broadcast_ticket_updated(structure_id, updated, position)
                await broadcast_queue_updated(structure_id)

                config = queue_engine.get_config(structure_id)
                type_name = config.types[updated.type_index]["name"] if updated.type_index < len(config.types) else "Standard"

                logger.info(f"Structure {structure_id}: ticket #{updated.number} changé vers type '{type_name}'")

                return {
                    "ticket": {
                        "uuid": updated.uuid,
                        "number": updated.number,
                        "type_index": updated.type_index,
                        "type_name": type_name
                    },
                    "new_position": position
                }

    raise HTTPException(status_code=404, detail="Ticket not found")

# ============================================================================
# ADMIN API - REQUIRES ADMIN ROLE
# ============================================================================

@app.get("/api/structures")
async def list_structures(
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """List all structures"""

    structures = db.query(Structure).all()

    result = []
    for s in structures:
        queue_len = queue_engine.get_queue_length(s.id)
        result.append({
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "address": s.address,
            "phone": s.phone,
            "is_active": s.is_active,
            "created_at": s.created_at.isoformat(),
            "current_queue_length": queue_len,
            "config": {
                "alpha": s.alpha,
                "beta": s.beta,
                "t_ref": s.t_ref,
                "ticket_ttl": s.ticket_ttl
            }
        })

    return {"structures": result}

@app.post("/api/structures")
async def create_structure(
    data: StructureCreate,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Create a new structure"""

    import uuid as uuid_lib
    import json

    structure_id = str(uuid_lib.uuid4())

    structure = Structure(
        id=structure_id,
        name=data.name,
        description=data.description,
        address=data.address,
        phone=data.phone,
        alpha=data.alpha,
        beta=data.beta,
        t_ref=data.t_ref,
        ticket_ttl=data.ticket_ttl,
        types_config=json.dumps(data.types) if data.types else json.dumps([
            {"name": "Standard", "priority": 1},
            {"name": "Priority", "priority": 2},
            {"name": "Urgent", "priority": 3}
        ])
    )

    db.add(structure)
    db.commit()
    db.refresh(structure)

    logger.info(f"Structure créée : '{structure.name}' (id={structure.id})")

    return {
        "id": structure.id,
        "name": structure.name,
        "message": "Structure created"
    }

@app.put("/api/structures/{structure_id}")
async def update_structure(
    structure_id: str,
    data: StructureUpdate,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Update a structure"""

    structure = db.query(Structure).filter(Structure.id == structure_id).first()

    if not structure:
        raise HTTPException(status_code=404, detail="Structure not found")

    # Update fields
    if data.name is not None:
        structure.name = data.name
    if data.description is not None:
        structure.description = data.description
    if data.address is not None:
        structure.address = data.address
    if data.phone is not None:
        structure.phone = data.phone
    if data.is_active is not None:
        structure.is_active = data.is_active
    if data.alpha is not None:
        structure.alpha = data.alpha
    if data.beta is not None:
        structure.beta = data.beta
    if data.t_ref is not None:
        structure.t_ref = data.t_ref
    if data.ticket_ttl is not None:
        structure.ticket_ttl = data.ticket_ttl
    if data.types is not None:
        import json
        structure.types_config = json.dumps(data.types)

    db.commit()

    # Update queue engine config
    import json
    types = json.loads(structure.types_config)
    queue_engine.set_config(structure_id, {
        "alpha": structure.alpha,
        "beta": structure.beta,
        "t_ref": structure.t_ref,
        "ticket_ttl": structure.ticket_ttl,
        "types": types
    })

    logger.info(f"Structure mise à jour : '{structure.name}' (id={structure.id})")

    return {
        "id": structure.id,
        "name": structure.name,
        "message": "Structure updated"
    }

@app.delete("/api/structures/{structure_id}")
async def delete_structure(
    structure_id: str,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Delete a structure"""

    structure = db.query(Structure).filter(Structure.id == structure_id).first()

    if not structure:
        raise HTTPException(status_code=404, detail="Structure not found")

    db.delete(structure)
    db.commit()

    logger.info(f"Structure supprimée (id={structure_id})")

    return {"message": "Structure deleted", "id": structure_id}

@app.get("/api/structures/{structure_id}/stats")
async def get_structure_stats(
    structure_id: str,
    days: int = 30,
    current_user: User = Depends(get_agent_user),
    db: Session = Depends(get_db)
):
    """
    Get statistics for a structure.
    Accessible by both ADMIN and AGENT (agent must belong to the structure).
    """

    # Agents can only see stats for their own structure
    if current_user.role != "ADMIN" and current_user.structure_id != structure_id:
        raise HTTPException(status_code=403, detail="Access denied to this structure")

    structure = db.query(Structure).filter(Structure.id == structure_id).first()

    if not structure:
        raise HTTPException(status_code=404, detail="Structure not found")

    from datetime import datetime as dt
    start_date = dt.utcnow() - timedelta(days=days)

    records = db.query(ServiceRecord).filter(
        and_(
            ServiceRecord.structure_id == structure_id,
            ServiceRecord.created_at >= start_date
        )
    ).all()

    if records:
        avg_service = sum(r.service_time for r in records) / len(records)
    else:
        avg_service = queue_engine.get_average_service_time(structure_id)

    # Get statistics from Statistics table
    stats = db.query(Statistics).filter(
        and_(
            Statistics.structure_id == structure_id,
            Statistics.date >= start_date
        )
    ).order_by(Statistics.date.desc()).all()

    return {
        "structure_id": structure_id,
        "structure_name": structure.name,
        "current_queue_length": queue_engine.get_queue_length(structure_id),
        "average_service_time": int(avg_service),
        "statistics": [
            {
                "date": s.date.isoformat(),
                "tickets_created": s.tickets_created,
                "tickets_served": s.tickets_served,
                "tickets_expired": s.tickets_expired,
                "avg_wait_time": s.avg_wait_time,
                "avg_service_time": s.avg_service_time
            }
            for s in stats
        ]
    }

@app.get("/api/agents")
async def list_agents(
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """List all agents"""

    agents = db.query(User).filter(User.role == "AGENT").all()

    return {
        "agents": [
            {
                "id": a.id,
                "name": a.name,
                "email": a.email,
                "structure_id": a.structure_id,
                "is_active": a.is_active,
                "created_at": a.created_at.isoformat()
            }
            for a in agents
        ]
    }

@app.post("/api/agents")
async def create_agent(
    data: UserRegister,
    structure_id: Optional[str] = None,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Create agent by admin"""

    # Check email
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role="AGENT",
        structure_id=structure_id
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    logger.info(f"Agent créé par admin (id={user.id})")

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "structure_id": user.structure_id,
        "message": "Agent created"
    }

@app.delete("/api/agents/{agent_id}")
async def delete_agent(
    agent_id: int,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Delete an agent"""

    agent = db.query(User).filter(
        and_(User.id == agent_id, User.role == "AGENT")
    ).first()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    db.delete(agent)
    db.commit()

    logger.info(f"Agent supprimé (id={agent_id})")

    return {"message": "Agent deleted", "id": agent_id}

@app.put("/api/structures/{structure_id}/config")
async def update_algorithm_config(
    structure_id: str,
    data: ConfigUpdate,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Update algorithm configuration"""

    structure = db.query(Structure).filter(Structure.id == structure_id).first()

    if not structure:
        raise HTTPException(status_code=404, detail="Structure not found")

    # Update database config
    if data.alpha is not None:
        structure.alpha = data.alpha
    if data.beta is not None:
        structure.beta = data.beta
    if data.t_ref is not None:
        structure.t_ref = data.t_ref
    if data.ticket_ttl is not None:
        structure.ticket_ttl = data.ticket_ttl
    if data.types is not None:
        import json
        structure.types_config = json.dumps(data.types)

    db.commit()

    # Update queue engine
    import json
    types = json.loads(structure.types_config)
    queue_engine.set_config(structure_id, {
        "alpha": structure.alpha,
        "beta": structure.beta,
        "t_ref": structure.t_ref,
        "ticket_ttl": structure.ticket_ttl,
        "types": types
    })

    logger.info(f"Configuration mise à jour pour la structure (id={structure_id})")

    return {
        "message": "Configuration updated",
        "config": {
            "alpha": structure.alpha,
            "beta": structure.beta,
            "t_ref": structure.t_ref,
            "ticket_ttl": structure.ticket_ttl,
            "types": types
        }
    }

# ============================================================================
# WEBSOCKET INFO ENDPOINT
# ============================================================================

@app.get("/api/ws/info")
async def websocket_info():
    """Get WebSocket connection information"""
    return {
        "namespaces": [
            {"path": "/ws/ticket", "description": "Ticket position updates"},
            {"path": "/ws/structure", "description": "Structure queue updates"},
            {"path": "/ws/display", "description": "Display screen updates"}
        ],
        "events": {
            "client_to_server": ["join_ticket", "join_structure", "join_display"],
            "server_to_client": [
                "ticket-created", "ticket-updated", "ticket-deleted",
                "queue-updated", "ticket-called", "position-alert",
                "position-update", "your-turn", "display-update"
            ]
        }
    }

# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "timestamp": int(time.time() * 1000),
        "active_structures": len(queue_engine._queues),
        "total_tickets": sum(len(q) for q in queue_engine._queues.values())
    }

# ============================================================================
# Application entry point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app:socket_app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=True
    )

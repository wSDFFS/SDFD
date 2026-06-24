"""
Database configuration and models for MySQL
Only stores: users, structures, configurations, statistics
"""
import os
from datetime import datetime
from sqlalchemy import create_engine, Column, String, Integer, Float, DateTime, Text, Enum, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:@localhost:3306/queue_system")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    """Users table - Admin and Agent accounts"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum('ADMIN', 'AGENT', name='user_role'), nullable=False, default='AGENT')
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    
    # Agent-specific fields
    structure_id = Column(String(36), ForeignKey('structures.id'), nullable=True)

class Structure(Base):
    """Queue structures/locations"""
    __tablename__ = "structures"
    
    id = Column(String(36), primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    address = Column(String(500), nullable=True)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Algorithm configuration
    alpha = Column(Float, default=1.0)
    beta = Column(Float, default=0.5)
    t_ref = Column(Integer, default=300)
    ticket_ttl = Column(Integer, default=3600)
    
    # Queue types configuration (JSON stored as text)
    types_config = Column(Text, default='[{"name":"Standard","priority":1},{"name":"Priority","priority":2},{"name":"Urgent","priority":3}]')

class Statistics(Base):
    """Aggregated daily statistics"""
    __tablename__ = "statistics"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    structure_id = Column(String(36), ForeignKey('structures.id'), nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)
    tickets_created = Column(Integer, default=0)
    tickets_served = Column(Integer, default=0)
    tickets_expired = Column(Integer, default=0)
    avg_wait_time = Column(Float, default=0.0)
    avg_service_time = Column(Float, default=0.0)
    max_wait_time = Column(Integer, default=0)
    max_queue_length = Column(Integer, default=0)

class ServiceRecord(Base):
    """Individual service records for sliding window average"""
    __tablename__ = "service_records"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    structure_id = Column(String(36), ForeignKey('structures.id'), nullable=False, index=True)
    service_time = Column(Float, nullable=False)  # in seconds
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

class RateLimitLog(Base):
    """Temporary rate limiting logs - auto-cleaned"""
    __tablename__ = "rate_limit_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    identifier = Column(String(64), nullable=False, index=True)  # IP or email hash
    action = Column(String(50), nullable=False, index=True)  # 'ticket', 'login'
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

def get_db():
    """Database session dependency"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initialize database tables"""
    Base.metadata.create_all(bind=engine)

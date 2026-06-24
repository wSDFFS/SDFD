"""
Queue Engine - Completely independent from FastAPI
Tickets are stored ONLY in RAM, never persisted
"""
import time
import uuid
import threading
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from collections import deque
import random

@dataclass
class Ticket:
    """Ticket model - RAM only, never persisted"""
    uuid: str
    number: int
    type_index: int
    priority_value: int
    created_at: int  # milliseconds timestamp
    structure_id: str

@dataclass
class QueueConfig:
    """Configuration for queue algorithm"""
    alpha: float = 1.0
    beta: float = 0.5
    t_ref: int = 300  # seconds
    ticket_ttl: int = 3600  # seconds
    types: List[Dict] = None
    
    def __post_init__(self):
        if self.types is None:
            self.types = [
                {"name": "Standard", "priority": 1},
                {"name": "Priority", "priority": 2},
                {"name": "Urgent", "priority": 3}
            ]

@dataclass
class ServiceMetrics:
    """Metrics for sliding window average"""
    service_times: deque  # Last 10 service times
    total_tickets: int = 0
    created_tickets: int = 0
    expired_tickets: int = 0

class QueueEngine:
    """
    Independent queue management engine
    All operations are in-memory only
    """
    
    def __init__(self):
        # Structure-based storage: {structure_id: {uuid: Ticket}}
        self._queues: Dict[str, Dict[str, Ticket]] = {}
        # Ticket number counters per structure
        self._counters: Dict[str, int] = {}
        # Configurations per structure
        self._configs: Dict[str, QueueConfig] = {}
        # Service metrics per structure
        self._metrics: Dict[str, ServiceMetrics] = {}
        # Thread lock for concurrent access
        self._lock = threading.RLock()
        # Ticket being served: {structure_id: ticket_uuid}
        self._current_ticket: Dict[str, Optional[str]] = {}
        # Last called ticket info for display
        self._last_called: Dict[str, Optional[Ticket]] = {}
    
    def _ensure_structure(self, structure_id: str):
        """Ensure structure exists in memory"""
        if structure_id not in self._queues:
            self._queues[structure_id] = {}
            self._counters[structure_id] = 0
            self._configs[structure_id] = QueueConfig()
            self._metrics[structure_id] = ServiceMetrics(service_times=deque(maxlen=10))
            self._current_ticket[structure_id] = None
            self._last_called[structure_id] = None
    
    def calculate_score(self, ticket: Ticket, cfg: QueueConfig) -> float:
        """
        Calculate priority score for ticket
        
        Score = alpha * priorityValue + beta * t_norm
        
        Where t_norm = (now - createdAt) / (tRef * 1000)
        t_norm must be strictly increasing
        """
        now = int(time.time() * 1000)
        t_norm = (now - ticket.created_at) / (cfg.t_ref * 1000)
        
        # Ensure t_norm is at least a small positive value
        t_norm = max(t_norm, 0.001)
        
        score = cfg.alpha * ticket.priority_value + cfg.beta * t_norm
        return score
    
    def create_ticket(
        self, 
        structure_id: str, 
        type_index: int = 0
    ) -> Ticket:
        """
        Create a new ticket
        
        Args:
            structure_id: Structure identifier
            type_index: Index in types configuration
            
        Returns:
            New Ticket instance
        """
        with self._lock:
            self._ensure_structure(structure_id)
            
            config = self._configs[structure_id]
            
            # Validate type index
            if type_index < 0 or type_index >= len(config.types):
                type_index = 0
            
            # Get priority from type
            priority_value = config.types[type_index].get("priority", 1)
            
            # Generate ticket number
            self._counters[structure_id] += 1
            number = self._counters[structure_id]
            
            # Create ticket
            ticket = Ticket(
                uuid=str(uuid.uuid4()),
                number=number,
                type_index=type_index,
                priority_value=priority_value,
                created_at=int(time.time() * 1000),
                structure_id=structure_id
            )
            
            # Store in queue
            self._queues[structure_id][ticket.uuid] = ticket
            
            # Update metrics
            self._metrics[structure_id].created_tickets += 1
            self._metrics[structure_id].total_tickets += 1
            
            return ticket
    
    def delete_ticket(self, structure_id: str, ticket_uuid: str) -> bool:
        """
        Delete a ticket from queue
        
        Returns:
            True if deleted, False if not found
        """
        with self._lock:
            if structure_id not in self._queues:
                return False
            
            if ticket_uuid not in self._queues[structure_id]:
                return False
            
            del self._queues[structure_id][ticket_uuid]
            return True
    
    def update_type(
        self, 
        structure_id: str, 
        ticket_uuid: str, 
        new_type_index: int
    ) -> Optional[Ticket]:
        """
        Update ticket type and priority
        
        Returns:
            Updated ticket or None if not found
        """
        with self._lock:
            if structure_id not in self._queues:
                return None
            
            if ticket_uuid not in self._queues[structure_id]:
                return None
            
            config = self._configs[structure_id]
            
            # Validate new type
            if new_type_index < 0 or new_type_index >= len(config.types):
                return None
            
            ticket = self._queues[structure_id][ticket_uuid]
            ticket.type_index = new_type_index
            ticket.priority_value = config.types[new_type_index].get("priority", 1)
            
            return ticket
    
    def get_position(self, structure_id: str, ticket_uuid: str) -> Optional[int]:
        """
        Get position of ticket in sorted queue
        
        Returns:
            Position (1-based) or None if not found
        """
        with self._lock:
            if structure_id not in self._queues:
                return None
            
            if ticket_uuid not in self._queues[structure_id]:
                return None
            
            sorted_queue = self.get_sorted_queue(structure_id)
            
            for i, ticket in enumerate(sorted_queue):
                if ticket.uuid == ticket_uuid:
                    return i + 1
            
            return None
    
    def sort_queue(self, structure_id: str) -> List[Ticket]:
        """
        Sort queue by score (descending), then FIFO for equal scores
        
        Returns:
            Sorted list of tickets
        """
        with self._lock:
            if structure_id not in self._queues:
                return []
            
            config = self._configs[structure_id]
            tickets = list(self._queues[structure_id].values())
            
            # Calculate scores
            ticket_scores = []
            for ticket in tickets:
                score = self.calculate_score(ticket, config)
                ticket_scores.append((score, ticket))
            
            # Sort: higher score first, then by creation time (FIFO for equal scores)
            ticket_scores.sort(key=lambda x: (-x[0], x[1].created_at))
            
            return [t[1] for t in ticket_scores]
    
    def get_sorted_queue(self, structure_id: str) -> List[Ticket]:
        """Get sorted queue (alias for sort_queue)"""
        return self.sort_queue(structure_id)

    def recalculate_queue_scores(self, structure_id: str) -> List[Ticket]:
        """
        Recalculate and re-sort the queue scores for a structure.

        Called explicitly by the 10-second scheduler to satisfy the CDC
        requirement of periodic score recalculation. Delegates to sort_queue()
        which recomputes calculate_score() for every ticket at the current
        instant — no algorithm or business logic is altered.

        Returns:
            Sorted list of tickets after recalculation
        """
        return self.sort_queue(structure_id)
    
    def get_next_ticket(self, structure_id: str) -> Optional[Ticket]:
        """
        Get next ticket to serve (highest priority)
        Removes ticket from queue
        
        Returns:
            Next ticket or None if queue empty
        """
        with self._lock:
            sorted_queue = self.get_sorted_queue(structure_id)
            
            if not sorted_queue:
                return None
            
            next_ticket = sorted_queue[0]
            
            # Remove from queue
            if structure_id in self._queues and next_ticket.uuid in self._queues[structure_id]:
                del self._queues[structure_id][next_ticket.uuid]
            
            # Track as current/last called
            self._current_ticket[structure_id] = next_ticket.uuid
            self._last_called[structure_id] = next_ticket
            
            return next_ticket
    
    def get_current_ticket(self, structure_id: str) -> Optional[Ticket]:
        """Get the currently being served ticket info"""
        return self._last_called.get(structure_id)
    
    def remove_expired_tickets(self, structure_id: str) -> int:
        """
        Remove tickets older than TTL
        
        Returns:
            Number of expired tickets removed
        """
        with self._lock:
            if structure_id not in self._queues:
                return 0
            
            config = self._configs[structure_id]
            now = int(time.time() * 1000)
            ttl_ms = config.ticket_ttl * 1000
            
            expired = 0
            to_remove = []
            
            for ticket_uuid, ticket in self._queues[structure_id].items():
                if now - ticket.created_at > ttl_ms:
                    to_remove.append(ticket_uuid)
            
            for uuid in to_remove:
                del self._queues[structure_id][uuid]
                expired += 1
                self._metrics[structure_id].expired_tickets += 1
            
            return expired
    
    def record_service_time(self, structure_id: str, service_time: float):
        """Record service time for sliding window average"""
        with self._lock:
            self._ensure_structure(structure_id)
            self._metrics[structure_id].service_times.append(service_time)
    
    def get_average_service_time(self, structure_id: str) -> float:
        """
        Get average service time from sliding window
        Returns default 300 seconds if no data
        """
        with self._lock:
            if structure_id not in self._metrics:
                return 300.0
            
            service_times = self._metrics[structure_id].service_times
            if not service_times:
                return 300.0
            
            return sum(service_times) / len(service_times)
    
    def get_estimated_wait(
        self, 
        structure_id: str, 
        position: int
    ) -> int:
        """
        Calculate estimated wait time
        
        Args:
            structure_id: Structure ID
            position: Position in queue (1-based)
            
        Returns:
            Estimated wait time in seconds
        """
        avg_service_time = self.get_average_service_time(structure_id)
        return int(position * avg_service_time)
    
    def get_queue_length(self, structure_id: str) -> int:
        """Get current queue length"""
        with self._lock:
            if structure_id not in self._queues:
                return 0
            return len(self._queues[structure_id])
    
    def get_metrics(self) -> Dict:
        """
        Get metrics for Prometheus
        
        Returns:
            Dict with all metrics
        """
        with self._lock:
            metrics = {
                "tickets_active": 0,
                "tickets_created_total": 0,
                "tickets_expired_total": 0,
                "structures": 0,
                "queues": {}
            }
            
            for structure_id, queue in self._queues.items():
                length = len(queue)
                metrics["tickets_active"] += length
                metrics["queues"][structure_id] = {
                    "active": length,
                    "created": self._metrics[structure_id].created_tickets,
                    "expired": self._metrics[structure_id].expired_tickets
                }
                metrics["tickets_created_total"] += self._metrics[structure_id].created_tickets
                metrics["tickets_expired_total"] += self._metrics[structure_id].expired_tickets
            
            metrics["structures"] = len(self._queues)
            return metrics
    
    def get_ticket(self, structure_id: str, ticket_uuid: str) -> Optional[Ticket]:
        """Get a specific ticket by UUID"""
        with self._lock:
            if structure_id not in self._queues:
                return None
            return self._queues[structure_id].get(ticket_uuid)
    
    def set_config(self, structure_id: str, config_data: Dict):
        """Set queue configuration for a structure"""
        with self._lock:
            self._ensure_structure(structure_id)
            
            config = self._configs[structure_id]
            config.alpha = config_data.get("alpha", config.alpha)
            config.beta = config_data.get("beta", config.beta)
            config.t_ref = config_data.get("t_ref", config.t_ref)
            config.ticket_ttl = config_data.get("ticket_ttl", config.ticket_ttl)
            
            if "types" in config_data:
                config.types = config_data["types"]
    
    def get_config(self, structure_id: str) -> QueueConfig:
        """Get queue configuration for a structure"""
        with self._lock:
            self._ensure_structure(structure_id)
            return self._configs[structure_id]
    
    def get_recent_tickets(self, structure_id: str, limit: int = 5) -> List[Ticket]:
        """Get most recent tickets for display"""
        with self._lock:
            if structure_id not in self._queues:
                return []
            
            tickets = list(self._queues[structure_id].values())
            tickets.sort(key=lambda x: x.created_at, reverse=True)
            return tickets[:limit]
    
    def get_queue_for_agent(self, structure_id: str) -> List[Dict]:
        """Get queue data formatted for agent interface"""
        with self._lock:
            sorted_queue = self.get_sorted_queue(structure_id)
            config = self._configs.get(structure_id, QueueConfig())
            avg_wait = self.get_average_service_time(structure_id)
            
            result = []
            for i, ticket in enumerate(sorted_queue):
                position = i + 1
                ticket_data = asdict(ticket)
                ticket_data["position"] = position
                ticket_data["estimated_wait"] = int(position * avg_wait)
                ticket_data["type_name"] = config.types[ticket.type_index]["name"] if ticket.type_index < len(config.types) else "Standard"
                result.append(ticket_data)
            
            return result

# Global queue engine instance
queue_engine = QueueEngine()
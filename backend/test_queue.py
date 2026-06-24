"""
Test suite for Queue System
Run with: pytest test_queue.py -v --cov=.
"""
import pytest
import time
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from core import QueueEngine, Ticket, QueueConfig

class TestQueueEngine:
    """Tests for QueueEngine class"""
    
    @pytest.fixture
    def engine(self):
        """Create a fresh queue engine for each test"""
        return QueueEngine()
    
    @pytest.fixture
    def config(self):
        """Standard queue configuration"""
        return QueueConfig(
            alpha=1.0,
            beta=0.5,
            t_ref=300,
            types=[
                {"name": "Standard", "priority": 1},
                {"name": "Priority", "priority": 2},
                {"name": "Urgent", "priority": 3}
            ]
        )
    
    def test_create_ticket(self, engine):
        """Test ticket creation"""
        engine.set_config("test-struct", {"types": [{"name": "Standard", "priority": 1}]})
        
        ticket = engine.create_ticket("test-struct", type_index=0)
        
        assert ticket.uuid is not None
        assert ticket.number == 1
        assert ticket.type_index == 0
        assert ticket.priority_value == 1
        assert ticket.structure_id == "test-struct"
        assert ticket.created_at > 0
    
    def test_create_multiple_tickets(self, engine):
        """Test creating multiple tickets increments number"""
        engine.set_config("test-struct", {"types": [{"name": "Standard", "priority": 1}]})
        
        ticket1 = engine.create_ticket("test-struct", 0)
        ticket2 = engine.create_ticket("test-struct", 0)
        ticket3 = engine.create_ticket("test-struct", 0)
        
        assert ticket1.number == 1
        assert ticket2.number == 2
        assert ticket3.number == 3
    
    def test_delete_ticket(self, engine):
        """Test ticket deletion"""
        engine.set_config("test-struct", {"types": [{"name": "Standard", "priority": 1}]})
        
        ticket = engine.create_ticket("test-struct", 0)
        assert engine.get_queue_length("test-struct") == 1
        
        result = engine.delete_ticket("test-struct", ticket.uuid)
        assert result is True
        assert engine.get_queue_length("test-struct") == 0
    
    def test_delete_nonexistent_ticket(self, engine):
        """Test deleting non-existent ticket returns False"""
        result = engine.delete_ticket("test-struct", "fake-uuid")
        assert result is False
    
    def test_update_type(self, engine):
        """Test updating ticket type"""
        engine.set_config("test-struct", {
            "types": [
                {"name": "Standard", "priority": 1},
                {"name": "Urgent", "priority": 3}
            ]
        })
        
        ticket = engine.create_ticket("test-struct", 0)
        assert ticket.priority_value == 1
        
        updated = engine.update_type("test-struct", ticket.uuid, 1)
        
        assert updated is not None
        assert updated.type_index == 1
        assert updated.priority_value == 3
    
    def test_get_position(self, engine):
        """Test getting ticket position"""
        engine.set_config("test-struct", {"types": [{"name": "Standard", "priority": 1}]})
        
        ticket1 = engine.create_ticket("test-struct", 0)
        ticket2 = engine.create_ticket("test-struct", 0)
        ticket3 = engine.create_ticket("test-struct", 0)
        
        # All same priority, so position should be FIFO
        pos1 = engine.get_position("test-struct", ticket1.uuid)
        pos2 = engine.get_position("test-struct", ticket2.uuid)
        pos3 = engine.get_position("test-struct", ticket3.uuid)
        
        assert pos1 == 1  # First created
        assert pos2 == 2
        assert pos3 == 3
    
    def test_get_next_ticket(self, engine):
        """Test getting next ticket"""
        engine.set_config("test-struct", {"types": [{"name": "Standard", "priority": 1}]})
        
        ticket1 = engine.create_ticket("test-struct", 0)
        ticket2 = engine.create_ticket("test-struct", 0)
        
        next_ticket = engine.get_next_ticket("test-struct")
        assert next_ticket.uuid == ticket1.uuid
        
        # Verify removed from queue
        assert engine.get_queue_length("test-struct") == 1
    
    def test_get_sorted_queue_empty(self, engine):
        """Test sorting empty queue"""
        queue = engine.sort_queue("test-struct")
        assert queue == []
    
    def test_calculate_score(self, engine, config):
        """Test score calculation"""
        now = int(time.time() * 1000)
        
        # Fresh ticket (just created)
        ticket_fresh = Ticket(
            uuid="test1",
            number=1,
            type_index=0,
            priority_value=1,
            created_at=now,
            structure_id="test"
        )
        
        score_fresh = engine.calculate_score(ticket_fresh, config)
        
        # Older ticket
        ticket_old = Ticket(
            uuid="test2",
            number=2,
            type_index=0,
            priority_value=1,
            created_at=now - 300000,  # 5 minutes ago
            structure_id="test"
        )
        
        score_old = engine.calculate_score(ticket_old, config)
        
        # Older ticket should have higher score (higher t_norm)
        assert score_old > score_fresh
    
    def test_calculate_score_priority(self, engine, config):
        """Test that higher priority gives higher score"""
        now = int(time.time() * 1000)
        
        # Standard priority
        ticket_standard = Ticket(
            uuid="test1",
            number=1,
            type_index=0,
            priority_value=1,
            created_at=now,
            structure_id="test"
        )
        
        # Urgent priority
        ticket_urgent = Ticket(
            uuid="test2",
            number=2,
            type_index=2,
            priority_value=3,
            created_at=now,
            structure_id="test"
        )
        
        score_standard = engine.calculate_score(ticket_standard, config)
        score_urgent = engine.calculate_score(ticket_urgent, config)
        
        # Urgent should have higher score due to priority
        assert score_urgent > score_standard
    
    def test_sort_by_priority(self, engine):
        """Test that queue is sorted by priority then time"""
        engine.set_config("test-struct", {
            "types": [
                {"name": "Standard", "priority": 1},
                {"name": "Priority", "priority": 2},
                {"name": "Urgent", "priority": 3}
            ],
            "alpha": 10.0,  # High alpha to prioritize priority
            "beta": 0.1
        })
        
        ticket1 = engine.create_ticket("test-struct", 0)  # Standard
        time.sleep(0.01)
        ticket2 = engine.create_ticket("test-struct", 2)  # Urgent
        time.sleep(0.01)
        ticket3 = engine.create_ticket("test-struct", 1)  # Priority
        time.sleep(0.01)
        ticket4 = engine.create_ticket("test-struct", 0)  # Standard
        
        sorted_queue = engine.sort_queue("test-struct")
        
        # First should be Urgent (highest priority)
        assert sorted_queue[0].uuid == ticket2.uuid
        
        # Second should be Priority
        assert sorted_queue[1].uuid == ticket3.uuid
    
    def test_fifo_on_equal_scores(self, engine):
        """Test that FIFO is used when scores are equal"""
        engine.set_config("test-struct", {
            "types": [{"name": "Standard", "priority": 1}],
            "alpha": 1.0,
            "beta": 0.0  # Only priority matters, no time factor
        })
        
        ticket1 = engine.create_ticket("test-struct", 0)
        time.sleep(0.01)
        ticket2 = engine.create_ticket("test-struct", 0)
        time.sleep(0.01)
        ticket3 = engine.create_ticket("test-struct", 0)
        
        sorted_queue = engine.sort_queue("test-struct")
        
        # Should be in creation order (FIFO)
        assert sorted_queue[0].uuid == ticket1.uuid
        assert sorted_queue[1].uuid == ticket2.uuid
        assert sorted_queue[2].uuid == ticket3.uuid
    
    def test_remove_expired_tickets(self, engine):
        """Test removing expired tickets"""
        engine.set_config("test-struct", {
            "types": [{"name": "Standard", "priority": 1}],
            "ticket_ttl": 1  # 1 second TTL
        })
        
        # Create ticket
        ticket = engine.create_ticket("test-struct", 0)
        assert engine.get_queue_length("test-struct") == 1
        
        # Wait for expiration
        time.sleep(1.5)
        
        # Remove expired
        expired_count = engine.remove_expired_tickets("test-struct")
        
        assert expired_count == 1
        assert engine.get_queue_length("test-struct") == 0
    
    def test_get_metrics(self, engine):
        """Test getting queue metrics"""
        engine.set_config("struct1", {"types": [{"name": "Standard", "priority": 1}]})
        engine.set_config("struct2", {"types": [{"name": "Standard", "priority": 1}]})
        
        engine.create_ticket("struct1", 0)
        engine.create_ticket("struct1", 0)
        engine.create_ticket("struct2", 0)
        
        metrics = engine.get_metrics()
        
        assert metrics["tickets_active"] == 3
        assert metrics["structures"] == 2
        assert metrics["tickets_created_total"] == 3
    
    def test_service_time_tracking(self, engine):
        """Test service time sliding window average"""
        engine._ensure_structure("test")
        
        engine.record_service_time("test", 100)
        engine.record_service_time("test", 200)
        engine.record_service_time("test", 300)
        
        avg = engine.get_average_service_time("test")
        assert avg == 200.0  # (100 + 200 + 300) / 3
    
    def test_estimated_wait(self, engine):
        """Test estimated wait calculation"""
        engine._ensure_structure("test")
        engine.record_service_time("test", 120)  # 2 minute average
        
        estimated = engine.get_estimated_wait("test", position=3)
        assert estimated == 360  # 3 * 120 seconds
    
    def test_multiple_structures(self, engine):
        """Test handling multiple independent structures"""
        engine.set_config("struct1", {"types": [{"name": "Standard", "priority": 1}]})
        engine.set_config("struct2", {"types": [{"name": "Standard", "priority": 1}]})
        
        ticket1 = engine.create_ticket("struct1", 0)
        ticket2 = engine.create_ticket("struct2", 0)
        
        assert ticket1.structure_id == "struct1"
        assert ticket2.structure_id == "struct2"
        
        assert engine.get_queue_length("struct1") == 1
        assert engine.get_queue_length("struct2") == 1
    
    def test_config_update(self, engine):
        """Test updating queue configuration"""
        engine.set_config("test", {
            "alpha": 2.0,
            "beta": 1.0,
            "types": [{"name": "VIP", "priority": 5}]
        })
        
        config = engine.get_config("test")
        
        assert config.alpha == 2.0
        assert config.beta == 1.0
        assert len(config.types) == 1
        assert config.types[0]["name"] == "VIP"

class TestScoreCalculation:
    """Specific tests for the scoring algorithm"""
    
    def test_t_norm_is_positive(self):
        """Test that t_norm is always positive"""
        engine = QueueEngine()
        config = QueueConfig(t_ref=300)
        
        # Ticket created in the future (edge case)
        future_time = int(time.time() * 1000) + 10000
        ticket = Ticket(
            uuid="test",
            number=1,
            type_index=0,
            priority_value=1,
            created_at=future_time,
            structure_id="test"
        )
        
        score = engine.calculate_score(ticket, config)
        
        # Score should still be valid (positive)
        assert score > 0
    
    def test_score_formula(self):
        """Test the exact score formula"""
        engine = QueueEngine()
        config = QueueConfig(alpha=2.0, beta=1.0, t_ref=300)
        
        now = int(time.time() * 1000)
        created_at = now - 60000  # 1 minute ago
        
        ticket = Ticket(
            uuid="test",
            number=1,
            type_index=0,
            priority_value=3,
            created_at=created_at,
            structure_id="test"
        )
        
        score = engine.calculate_score(ticket, config)
        
        # t_norm = 60000 / (300 * 1000) = 0.2
        # score = 2.0 * 3 + 1.0 * 0.2 = 6.2
        expected = 2.0 * 3 + 1.0 * 0.2
        
        assert abs(score - expected) < 0.01

class TestConcurrency:
    """Test thread safety"""
    
    def test_concurrent_ticket_creation(self):
        """Test creating tickets from multiple threads"""
        import threading
        
        engine = QueueEngine()
        engine.set_config("test", {"types": [{"name": "Standard", "priority": 1}]})
        
        results = []
        
        def create_ticket():
            ticket = engine.create_ticket("test", 0)
            results.append(ticket)
        
        threads = [threading.Thread(target=create_ticket) for _ in range(100)]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        assert len(results) == 100
        assert engine.get_queue_length("test") == 100
        
        # All ticket numbers should be unique
        numbers = [t.number for t in results]
        assert len(set(numbers)) == 100

if __name__ == "__main__":
    pytest.main([__file__, "-v"])

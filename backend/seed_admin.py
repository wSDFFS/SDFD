#!/usr/bin/env python3
"""
Seed script to create initial admin user
Run this script directly in MySQL or via Python

Usage:
    python seed_admin.py
"""
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bcrypt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Load environment
load_dotenv()

# Import models
from db import User, Base

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:@localhost:3306/queue_system")

# Admin credentials - CHANGE THESE!
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "AdminPassword123!"
ADMIN_NAME = "System Admin"

def seed_admin():
    """Create initial admin user"""
    
    engine = create_engine(DATABASE_URL)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        # Check if admin exists
        existing = session.query(User).filter(User.email == ADMIN_EMAIL).first()
        
        if existing:
            print(f"Admin already exists: {ADMIN_EMAIL}")
            return
        
        # Hash password
        password_hash = bcrypt.hashpw(
            ADMIN_PASSWORD.encode('utf-8'), 
            bcrypt.gensalt()
        ).decode('utf-8')
        
        # Create admin
        admin = User(
            name=ADMIN_NAME,
            email=ADMIN_EMAIL,
            password_hash=password_hash,
            role="ADMIN",
            is_active=True
        )
        
        session.add(admin)
        session.commit()
        
        print(f"Admin created successfully!")
        print(f"Email: {ADMIN_EMAIL}")
        print(f"Password: {ADMIN_PASSWORD}")
        print("\nIMPORTANT: Change these credentials immediately after first login!")
        
    except Exception as e:
        session.rollback()
        print(f"Error creating admin: {e}")
        raise
    finally:
        session.close()

if __name__ == "__main__":
    # First ensure tables exist
    from db import init_db
    init_db()
    
    # Then seed admin
    seed_admin()

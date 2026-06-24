-- Database: queue_system
-- Execute in phpMyAdmin or MySQL CLI

CREATE DATABASE IF NOT EXISTS queue_system 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE queue_system;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('ADMIN', 'AGENT') NOT NULL DEFAULT 'AGENT',
    structure_id VARCHAR(36),
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_structure (structure_id)
) ENGINE=InnoDB;

-- Structures table
CREATE TABLE IF NOT EXISTS structures (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    address VARCHAR(500),
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    alpha FLOAT DEFAULT 1.0,
    beta FLOAT DEFAULT 0.5,
    t_ref INT DEFAULT 300,
    ticket_ttl INT DEFAULT 3600,
    types_config TEXT DEFAULT '[{"name":"Standard","priority":1},{"name":"Priority","priority":2},{"name":"Urgent","priority":3}]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_active (is_active)
) ENGINE=InnoDB;

-- Statistics table
CREATE TABLE IF NOT EXISTS statistics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    structure_id VARCHAR(36) NOT NULL,
    date DATETIME NOT NULL,
    tickets_created INT DEFAULT 0,
    tickets_served INT DEFAULT 0,
    tickets_expired INT DEFAULT 0,
    avg_wait_time FLOAT DEFAULT 0,
    avg_service_time FLOAT DEFAULT 0,
    max_wait_time INT DEFAULT 0,
    max_queue_length INT DEFAULT 0,
    INDEX idx_structure_date (structure_id, date),
    FOREIGN KEY (structure_id) REFERENCES structures(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Service records for sliding window
CREATE TABLE IF NOT EXISTS service_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    structure_id VARCHAR(36) NOT NULL,
    service_time FLOAT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_structure_created (structure_id, created_at),
    FOREIGN KEY (structure_id) REFERENCES structures(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Add foreign key for users
ALTER TABLE users 
ADD CONSTRAINT fk_user_structure 
FOREIGN KEY (structure_id) REFERENCES structures(id) ON DELETE SET NULL;

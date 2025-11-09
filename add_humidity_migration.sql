-- Migration script to add HUMIDITY column to existing device tables
-- Run this script after updating your backend to support humidity

-- This script will add the HUMIDITY column to all existing device tables
-- Replace 'ESP_2EB804' with your actual device table names

-- Example for a device table (replace with your actual device table name):
-- ALTER TABLE `ESP_2EB804` ADD COLUMN `HUMIDITY` int(20) DEFAULT NULL AFTER `TEMP`;

-- To find all your device tables, run:
-- SHOW TABLES;

-- Then for each device table, run:
-- ALTER TABLE `your_device_table_name` ADD COLUMN `HUMIDITY` int(20) DEFAULT NULL AFTER `TEMP`;

-- Notes:
-- - This adds humidity as a nullable field, so existing records will have NULL humidity
-- - New records inserted by the updated backend will include humidity values
-- - The column is added after the TEMP column for consistency

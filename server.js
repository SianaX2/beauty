// Import SQL.js
let SQL = null;
let db = null;
const DB_NAME = 'BeautyZoneDB';
const STORE_NAME = 'sqliteDB';
const DB_KEY = 'database';

// Initialize IndexedDB
async function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        
        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(new Error('Could not open IndexedDB: ' + event.target.error.message));
        };
        
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
                console.log('Created new object store:', STORE_NAME);
            }
        };
    });
}

// Save database to IndexedDB
async function saveToIndexedDB(data) {
    if (!data) {
        console.error('No data to save');
        return false;
    }
    
    try {
        const idb = await initIndexedDB();
        return new Promise((resolve, reject) => {
            const transaction = idb.transaction([STORE_NAME], 'readwrite');
            
            transaction.oncomplete = () => {
                console.log('Database saved successfully');
                resolve(true);
            };
            
            transaction.onerror = (event) => {
                console.error('Transaction error:', event.target.error);
                reject(new Error('Failed to save database: ' + event.target.error.message));
            };
            
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(data, DB_KEY);
            
            request.onerror = (event) => {
                console.error('Store error:', event.target.error);
                // Don't reject here as transaction.onerror will handle it
            };
        });
    } catch (error) {
        console.error('Error saving to IndexedDB:', error);
        return false;
    }
}

// Load database from IndexedDB
async function loadFromIndexedDB() {
    try {
        const idb = await initIndexedDB();
        return new Promise((resolve, reject) => {
            const transaction = idb.transaction([STORE_NAME], 'readonly');
            
            transaction.onerror = (event) => {
                console.error('Transaction error:', event.target.error);
                reject(new Error('Failed to load database: ' + event.target.error.message));
            };
            
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(DB_KEY);
            
            request.onsuccess = () => {
                if (request.result) {
                    console.log('Database loaded successfully');
                    resolve(request.result);
                } else {
                    console.log('No database found in IndexedDB');
                    resolve(null);
                }
            };
            
            request.onerror = (event) => {
                console.error('Store error:', event.target.error);
                // Don't reject here as transaction.onerror will handle it
            };
        });
    } catch (error) {
        console.error('Error loading from IndexedDB:', error);
        return null;
    }
}

// Check if database is initialized
function isDatabaseInitialized() {
    return SQL !== null && db !== null;
}

// Load existing database or create new one
export async function setupDatabase() {
    try {
        // Load SQL.js if not already loaded
        if (!SQL) {
            console.log('Loading SQL.js...');
            SQL = await window.initSqlJs({
                locateFile: file => `https://sql.js.org/dist/${file}`
            });
            console.log('SQL.js loaded successfully');
        }

        // Try to load existing database from IndexedDB
        const savedData = await loadFromIndexedDB();
        
        if (savedData) {
            try {
                console.log('Creating database from saved data');
                db = new SQL.Database(new Uint8Array(savedData));
                
                // Verify database integrity with a simple query
                try {
                    const testQuery = db.exec('SELECT 1');
                    console.log('Database integrity verified');
                } catch (integrityError) {
                    console.error('Database integrity check failed:', integrityError);
                    throw new Error('Corrupted database detected');
                }
            } catch (dbError) {
                console.error('Error creating database from saved data:', dbError);
                db = null;
                throw new Error('Failed to load existing database: ' + dbError.message);
            }
        }
        
        // Create a new database if loading failed or no saved data
        if (!db) {
            console.log('Creating new database');
            db = new SQL.Database();
            
            // Create tables with updated schema
            const sqlStr = `
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    email TEXT UNIQUE,
                    password TEXT NOT NULL,
                    phone TEXT,
                    role TEXT DEFAULT 'user',
                    reset_token TEXT,
                    reset_token_expires DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                
                -- Only insert sample data if the table is empty
                INSERT OR IGNORE INTO users (name, email, password, role)
                SELECT 'Admin User', 'admin@beautylounge.com', 'admin123', 'admin'
                WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@beautylounge.com');
            `;
            
            // Execute multiple SQL statements
            db.run(sqlStr);
            
            // Save the new database
            await saveToIndexedDB(db.export());
        }
        
        return db;
    } catch (error) {
        console.error('Error setting up database:', error);
        throw error;
    }
}

// Register new user
export async function registerUser(name, email, password, phone) {
    try {
        if (!isDatabaseInitialized()) throw new Error('Database not initialized');
        
        // Check if email already exists
        const checkStmt = db.prepare('SELECT COUNT(*) as count FROM users WHERE email = :email');
        const result = checkStmt.getAsObject({':email': email});
        checkStmt.free();
        
        if (result.count > 0) {
            throw new Error('Email already exists');
        }
        
        // In a real application, you should hash the password before storing
        const stmt = db.prepare(`
            INSERT INTO users (name, email, password, phone, role)
            VALUES (:name, :email, :password, :phone, 'user')
        `);
        
        stmt.run({':name': name, ':email': email, ':password': password, ':phone': phone});
        stmt.free();
        
        await saveToIndexedDB(db.export());
        
        // Return user data without password
        const newUser = db.exec('SELECT id, name, email, phone, role FROM users WHERE email = ?', [email])[0].values[0];
        return formatUserData(newUser);
    } catch (error) {
        console.error('Error registering user:', error);
        throw error;
    }
}

// Login user
export function loginUser(email, password) {
    try {
        if (!isDatabaseInitialized()) throw new Error('Database not initialized');
        
        // In a real application, you would hash the password and compare hashes
        const stmt = db.prepare('SELECT id, name, email, phone, role FROM users WHERE email = :email AND password = :password');
        const result = stmt.getAsObject({':email': email, ':password': password});
        stmt.free();
        
        if (!result.id) {
            throw new Error('Invalid email or password');
        }
        
        return formatUserData([result.id, result.name, result.email, result.role]);
    } catch (error) {
        console.error('Error logging in:', error);
        throw error;
    }
}

// Generate password reset token
export async function generateResetToken(email) {
    try {
        if (!isDatabaseInitialized()) throw new Error('Database not initialized');
        
        // Check if user exists
        const checkStmt = db.prepare('SELECT COUNT(*) as count FROM users WHERE email = :email');
        const result = checkStmt.getAsObject({':email': email});
        checkStmt.free();
        
        if (result.count === 0) {
            throw new Error('Email not found');
        }
        
        // Generate a random token
        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
        
        const stmt = db.prepare(`
            UPDATE users 
            SET reset_token = :token, reset_token_expires = :expires 
            WHERE email = :email
        `);
        
        stmt.run({':token': token, ':expires': expires, ':email': email});
        stmt.free();
        
        await saveToIndexedDB(db.export());
        
        return token;
    } catch (error) {
        console.error('Error generating reset token:', error);
        throw error;
    }
}

// Reset password using token
export async function resetPassword(token, newPassword) {
    try {
        if (!isDatabaseInitialized()) throw new Error('Database not initialized');
        
        // Check if token is valid and not expired
        const stmt = db.prepare(`
            SELECT id FROM users 
            WHERE reset_token = :token 
            AND reset_token_expires > CURRENT_TIMESTAMP
        `);
        
        const result = stmt.getAsObject({':token': token});
        stmt.free();
        
        if (!result.id) {
            throw new Error('Invalid or expired reset token');
        }
        
        // Update password and clear reset token
        const updateStmt = db.prepare(`
            UPDATE users 
            SET password = :password, reset_token = NULL, reset_token_expires = NULL 
            WHERE id = :id
        `);
        
        updateStmt.run({':password': newPassword, ':id': result.id});
        updateStmt.free();
        
        await saveToIndexedDB(db.export());
        
        return true;
    } catch (error) {
        console.error('Error resetting password:', error);
        throw error;
    }
}

// Add a new user using prepared statement
export async function addUser(name, email, role) {
    try {
        if (!isDatabaseInitialized()) throw new Error('Database not initialized');
        
        // Check if email already exists
        const checkStmt = db.prepare('SELECT COUNT(*) as count FROM users WHERE email = :email');
        const result = checkStmt.getAsObject({':email': email});
        checkStmt.free();
        
        if (result.count > 0) {
            throw new Error('Email already exists');
        }
        
        // Prepare the statement
        const stmt = db.prepare('INSERT INTO users (name, email, role) VALUES (:name, :email, :role)');
        
        // Execute the statement with parameters
        stmt.run({':name': name, ':email': email, ':role': role});
        
        // Free the statement
        stmt.free();
        
        // Save changes to IndexedDB
        await saveToIndexedDB(db.export());
        
        return true;
    } catch (error) {
        console.error('Error adding user:', error);
        throw error;
    }
}

// Get all users using exec
export function getAllUsers() {
    try {
        if (!isDatabaseInitialized()) throw new Error('Database not initialized');
        
        const results = db.exec('SELECT * FROM users ORDER BY name');
        return results[0]?.values || [];
    } catch (error) {
        console.error('Error getting users:', error);
        throw error;
    }
}

// Delete user by id using prepared statement
export async function deleteUser(id) {
    try {
        if (!isDatabaseInitialized()) throw new Error('Database not initialized');
        
        // Check if user exists
        const checkStmt = db.prepare('SELECT COUNT(*) as count FROM users WHERE id = :id');
        const result = checkStmt.getAsObject({':id': id});
        checkStmt.free();
        
        if (result.count === 0) {
            throw new Error('User not found');
        }
        
        // Prepare the statement
        const stmt = db.prepare('DELETE FROM users WHERE id = :id');
        
        // Execute the statement with parameter
        stmt.run({':id': id});
        
        // Free the statement
        stmt.free();
        
        // Save changes to IndexedDB
        await saveToIndexedDB(db.export());
        
        return true;
    } catch (error) {
        console.error('Error deleting user:', error);
        throw error;
    }
}

// Format user data for display
export function formatUserData(user) {
    if (!user) return null;
    
    return {
        id: user[0],
        name: user[1],
        email: user[2],
        role: user[3]
    };
}

// Export database to binary array
export function exportDatabase() {
    if (!isDatabaseInitialized()) throw new Error('Database not initialized');
    return db.export();
}

// Clear database from IndexedDB (for troubleshooting)
export async function clearDatabase() {
    try {
        const idb = await initIndexedDB();
        return new Promise((resolve, reject) => {
            const transaction = idb.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(DB_KEY);
            
            request.onsuccess = () => {
                console.log('Database cleared from IndexedDB');
                // Reset the in-memory database
                if (db) {
                    db.close();
                    db = null;
                }
                resolve(true);
            };
            
            request.onerror = (event) => {
                console.error('Error clearing database:', event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error('Error clearing database:', error);
        return false;
    }
}
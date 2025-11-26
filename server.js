const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const PORT = 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('trust proxy', true); // Enable IP trust for behind proxies

// Initialize SQLite Database
const db = new sqlite3.Database('./voting.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
  db.serialize(() => {
    // Candidates table
    db.run(`CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Votes table - Modified to track IP instead of voter ID
    db.run(`CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      ip_address TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (candidate_id) REFERENCES candidates (id)
    )`);

    console.log('Database tables initialized');
  });
}

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// API Routes

// Get all candidates with vote counts
app.get('/api/candidates', (req, res) => {
  const query = `
    SELECT 
      c.*, 
      COUNT(v.id) as vote_count 
    FROM candidates c 
    LEFT JOIN votes v ON c.id = v.candidate_id 
    GROUP BY c.id 
    ORDER BY c.name
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Add candidate
app.post('/api/candidates', (req, res) => {
  const { name, description, image_url } = req.body;

  if (!name) {
    res.status(400).json({ error: 'Candidate name is required' });
    return;
  }

  db.run(
    'INSERT INTO candidates (name, description, image_url) VALUES (?, ?, ?)',
    [name, description || '', image_url || ''],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      const candidateId = this.lastID;
      db.get('SELECT * FROM candidates WHERE id = ?', [candidateId], (err, row) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        io.emit('candidates-updated');
        res.json(row);
      });
    }
  );
});

// Update candidate
app.put('/api/candidates/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, image_url } = req.body;

  db.run(
    'UPDATE candidates SET name = ?, description = ?, image_url = ? WHERE id = ?',
    [name, description, image_url, id],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      db.get('SELECT * FROM candidates WHERE id = ?', [id], (err, row) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        io.emit('candidates-updated');
        res.json(row);
      });
    }
  );
});

// Delete candidate
app.delete('/api/candidates/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM candidates WHERE id = ?', [id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    io.emit('candidates-updated');
    res.json({ message: 'Candidate deleted successfully', changes: this.changes });
  });
});

// Submit vote
app.post('/api/vote', (req, res) => {
  const { candidateId } = req.body;
  // Get IP address
  const ip = req.ip || req.connection.remoteAddress;

  if (!candidateId) {
    res.status(400).json({ error: 'Candidate ID is required' });
    return;
  }

  // Check if IP already voted
  db.get('SELECT id FROM votes WHERE ip_address = ?', [ip], (err, vote) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (vote) {
      res.status(400).json({ error: 'You have already voted from this device/network.' });
      return;
    }

    // Insert vote
    db.run(
      'INSERT INTO votes (candidate_id, ip_address) VALUES (?, ?)',
      [candidateId, ip],
      function (err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }

        io.emit('vote-submitted');
        io.emit('candidates-updated'); // Trigger update to show new counts

        res.json({
          message: 'Vote submitted successfully',
          voteId: this.lastID
        });
      }
    );
  });
});

// Get results
app.get('/api/results', (req, res) => {
  const query = `
    SELECT 
      c.id,
      c.name,
      c.description,
      c.image_url,
      COUNT(v.id) as vote_count
    FROM candidates c
    LEFT JOIN votes v ON c.id = v.candidate_id
    GROUP BY c.id
    ORDER BY vote_count DESC, c.name
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get detailed voting data (for admin)
app.get('/api/votes/details', (req, res) => {
  const query = `
    SELECT 
      votes.ip_address,
      candidates.name as candidate_name,
      votes.timestamp
    FROM votes
    JOIN candidates ON votes.candidate_id = candidates.id
    ORDER BY votes.timestamp DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Export to Excel
app.get('/api/export/excel', async (req, res) => {
  try {
    const query = `
      SELECT 
        votes.ip_address,
        candidates.name as candidate_name,
        votes.timestamp
      FROM votes
      JOIN candidates ON votes.candidate_id = candidates.id
      ORDER BY votes.timestamp DESC
    `;

    db.all(query, [], async (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Voting Results');

      // Add headers
      worksheet.columns = [
        { header: 'IP Address', key: 'ip_address', width: 25 },
        { header: 'Voted For', key: 'candidate_name', width: 25 },
        { header: 'Timestamp', key: 'timestamp', width: 20 }
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4CAF50' }
      };

      // Add data
      rows.forEach(row => {
        worksheet.addRow(row);
      });

      // Add summary sheet
      const summarySheet = workbook.addWorksheet('Summary');

      const summaryQuery = `
        SELECT 
          c.name as candidate_name,
          COUNT(v.id) as vote_count
        FROM candidates c
        LEFT JOIN votes v ON c.id = v.candidate_id
        GROUP BY c.id
        ORDER BY vote_count DESC
      `;

      db.all(summaryQuery, [], async (err, summaryRows) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }

        summarySheet.columns = [
          { header: 'Candidate', key: 'candidate_name', width: 25 },
          { header: 'Total Votes', key: 'vote_count', width: 15 }
        ];

        summarySheet.getRow(1).font = { bold: true };
        summarySheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2196F3' }
        };

        summaryRows.forEach(row => {
          summarySheet.addRow(row);
        });

        // Set response headers
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename=voting_results_${Date.now()}.xlsx`
        );

        // Write to response
        await workbook.xlsx.write(res);
        res.end();
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Voting system running on http://localhost:${PORT}`);
});

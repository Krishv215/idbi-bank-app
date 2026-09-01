    const path = require('path');

// Serve static frontend files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Deliver Customer App on main link
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'idbi_mobile_customer.html'));
});

// Deliver Admin Portal on /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'idbi_admin_portal.html'));
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const twilio = require('twilio');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Twilio Setup
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

// ================= CENTRAL REAL-TIME LEDGER =================
let accounts = [
  { id: '1', name: 'Rahul Sharma', custId: '1001', accNum: '102345678901', mpin: '1234', type: 'Savings Account', balance: 75420.50, isFrozen: false, secBirth: 'Mumbai', secMother: 'Sharma', cardTier: 'auto', isCardLocked: false, cardPin: '4321' },
  { id: '2', name: 'Pooja Verma', custId: '1002', accNum: '102345678902', mpin: '5678', type: 'Salary Account', balance: 11492000.00, isFrozen: false, secBirth: 'Delhi', secMother: 'Verma', cardTier: 'auto', isCardLocked: false, cardPin: '9876' }
];

let transactions = [
  { id: 'TXN8912401', time: '2026-08-30 09:15 AM', from: '102345678901', to: '102345678902', amount: 5000.00, status: 'SUCCESS' },
  { id: 'TXN8912402', time: '2026-08-30 10:05 AM', from: '102345678902', to: '102345678901', amount: 1200.00, status: 'SUCCESS' }
];

let adminApprovalRequests = [];
let savingsLeads = [];
const otpStore = new Map();

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'idbi_mobile_customer.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'idbi_admin_portal.html')));

// Broadcast helpers
function broadcastStateUpdate() {
  io.emit('cbs_state_sync', {
    accounts,
    transactions,
    adminApprovalRequests,
    savingsLeads
  });
}

// ================= SOCKET.IO REALTIME EVENTS =================
io.on('connection', (socket) => {
  // Push full fresh state immediately upon connection
  socket.emit('cbs_state_sync', {
    accounts,
    transactions,
    adminApprovalRequests,
    savingsLeads
  });

  // Client requests sync
  socket.on('request_state_refresh', () => {
    socket.emit('cbs_state_sync', { accounts, transactions, adminApprovalRequests, savingsLeads });
  });

  // New Account Opening Lead
  socket.on('new_savings_lead', (leadData) => {
    savingsLeads.unshift(leadData);
    broadcastStateUpdate();
    io.emit('notify_admin_lead', leadData);
  });

  // New Security / MPIN / Activation Request
  socket.on('new_admin_request', (requestData) => {
    adminApprovalRequests.unshift(requestData);
    broadcastStateUpdate();
    io.emit('notify_admin_request', requestData);
  });

  // Fund Transfer
  socket.on('execute_fund_transfer', (txData) => {
    const { fromAcc, toAcc, amount } = txData;
    const sender = accounts.find(a => a.accNum === fromAcc);
    const receiver = accounts.find(a => a.accNum === toAcc);

    if (sender && receiver && sender.balance >= amount && !sender.isFrozen && !receiver.isFrozen) {
      sender.balance -= amount;
      receiver.balance += amount;

      const txRecord = {
        id: 'IMPS' + Math.floor(1000000 + Math.random() * 9000000),
        time: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        from: fromAcc,
        to: toAcc,
        amount: amount,
        status: 'SUCCESS'
      };
      transactions.push(txRecord);
      broadcastStateUpdate();
    }
  });

  // Admin commits account update / action
  socket.on('admin_update_accounts', (updatedAccounts) => {
    accounts = updatedAccounts;
    broadcastStateUpdate();
  });

  socket.on('admin_update_requests', (updatedRequests) => {
    adminApprovalRequests = updatedRequests;
    broadcastStateUpdate();
  });

  socket.on('admin_update_leads', (updatedLeads) => {
    savingsLeads = updatedLeads;
    broadcastStateUpdate();
  });
});

// ================= REST APIS =================
app.post('/api/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone number is required.' });

    const cleanDigits = phone.replace(/\D/g, '');
    const formattedPhone = phone.startsWith('+') ? phone : `+91${cleanDigits.slice(-10)}`;
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore.set(formattedPhone, { otp: generatedOtp, expiresAt: Date.now() + 5 * 60 * 1000 });

    let smsDispatched = false;
    try {
      await client.messages.create({
        body: `Your IDBI Bank verification code is ${generatedOtp}. Valid for 5 minutes.`,
        from: twilioNumber,
        to: formattedPhone
      });
      smsDispatched = true;
    } catch (err) {
      console.log(`[Dev OTP for ${formattedPhone}]: ${generatedOtp}`);
    }

    return res.json({
      success: true,
      message: smsDispatched ? 'OTP sent via SMS.' : `Trial mode: OTP is ${generatedOtp}`
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  const cleanDigits = (phone || '').replace(/\D/g, '');
  const formattedPhone = phone.startsWith('+') ? phone : `+91${cleanDigits.slice(-10)}`;

  const record = otpStore.get(formattedPhone);
  if (!record || Date.now() > record.expiresAt) {
    return res.status(400).json({ success: false, message: 'OTP expired or not requested.' });
  }
  if (record.otp !== (otp || '').trim()) {
    return res.status(400).json({ success: false, message: 'Incorrect OTP.' });
  }

  otpStore.delete(formattedPhone);
  return res.json({ success: true, message: 'Verified successfully.' });
});

app.get('/api/state', (req, res) => {
  res.json({ accounts, transactions, adminApprovalRequests, savingsLeads });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`IDBI Realtime CBS Server active on port ${PORT}`));

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Twilio Setup
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

// ================= CENTRAL SHARED DATABASE IN SERVER MEMORY =================
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

// ================= HTML ROUTES =================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'idbi_mobile_customer.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'idbi_admin_portal.html'));
});

// ================= 1. OTP AUTHENTICATION =================
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
    } catch (twilioErr) {
      console.log(`[Dev OTP for ${formattedPhone}]: ${generatedOtp}`);
    }

    return res.json({
      success: true,
      message: smsDispatched ? 'OTP sent via SMS.' : `Demo mode: Your OTP is ${generatedOtp}`
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const cleanDigits = (phone || '').replace(/\D/g, '');
    const formattedPhone = phone.startsWith('+') ? phone : `+91${cleanDigits.slice(-10)}`;

    const record = otpStore.get(formattedPhone);
    if (!record || Date.now() > record.expiresAt) {
      return res.status(400).json({ success: false, message: 'OTP expired or not requested.' });
    }
    if (record.otp !== otp.trim()) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP.' });
    }

    otpStore.delete(formattedPhone);
    return res.json({ success: true, message: 'Verified successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ================= 2. SHARED ACCOUNTS API =================
app.get('/api/accounts', (req, res) => res.json(accounts));

app.post('/api/accounts', (req, res) => {
  const newAcc = req.body;
  accounts.push(newAcc);
  res.json({ success: true, accounts });
});

app.put('/api/accounts', (req, res) => {
  accounts = req.body;
  res.json({ success: true, accounts });
});

// ================= 3. SHARED TRANSACTIONS API =================
app.get('/api/transactions', (req, res) => res.json(transactions));

app.post('/api/transactions', (req, res) => {
  const newTx = req.body;
  transactions.push(newTx);
  res.json({ success: true, transactions });
});

// ================= 4. SHARED APPROVAL REQUESTS API =================
app.get('/api/requests', (req, res) => res.json(adminApprovalRequests));

app.post('/api/requests', (req, res) => {
  adminApprovalRequests.unshift(req.body);
  res.json({ success: true, requests: adminApprovalRequests });
});

app.put('/api/requests', (req, res) => {
  adminApprovalRequests = req.body;
  res.json({ success: true, requests: adminApprovalRequests });
});

// ================= 5. SHARED SAVINGS LEADS API =================
app.get('/api/leads', (req, res) => res.json(savingsLeads));

app.post('/api/leads', (req, res) => {
  savingsLeads.unshift(req.body);
  res.json({ success: true, leads: savingsLeads });
});

app.put('/api/leads', (req, res) => {
  savingsLeads = req.body;
  res.json({ success: true, leads: savingsLeads });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`IDBI Central CBS running on port ${PORT}`));

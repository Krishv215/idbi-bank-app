require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const otpStore = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'idbi_mobile_customer.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'idbi_admin_portal.html'));
});

// Send SMS OTP
app.post('/api/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone is required.' });

    const cleanDigits = phone.replace(/\D/g, '');
    const formattedPhone = phone.startsWith('+') ? phone : `+91${cleanDigits.slice(-10)}`;
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore.set(formattedPhone, { otp: generatedOtp, expiresAt: Date.now() + 5 * 60 * 1000 });

    let smsDispatched = false;
    try {
      await client.messages.create({
        body: `Your IDBI Bank code is ${generatedOtp}. Valid for 5 minutes.`,
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

// Verify SMS OTP
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const express = require('express');
const cors = require('cors');
const sql = require('mssql/msnodesqlv8');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

if (!process.env.DB_SERVER || !process.env.DB_DATABASE) {
  throw new Error('DB_SERVER and DB_DATABASE must be set in server/.env');
}

const dbServer = process.env.DB_SERVER;
const dbPort = Number(process.env.DB_PORT || 1433);
const dbDatabase = process.env.DB_DATABASE;
const useWindowsAuth = (process.env.DB_AUTH || 'windows').toLowerCase() === 'windows';
const dbUser = process.env.DB_USER || '';
const dbPassword = process.env.DB_PASSWORD || '';
const appUrl = process.env.APP_URL || 'http://localhost:3000';
const companyName = process.env.COMPANY_NAME || 'HR Voice Scheduler';
const publicApiUrl = process.env.PUBLIC_API_URL || '';
const twilioConfigured = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER &&
  publicApiUrl
);
const twilioClient = twilioConfigured
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
const mailConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
const mailer = mailConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    })
  : null;
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    callback(null, allowedTypes.includes(file.mimetype));
  }
});
const authenticationPart = useWindowsAuth
  ? 'Trusted_Connection=Yes'
  : `Uid=${dbUser};Pwd={${dbPassword}}`;

const config = {
  server: dbServer,
  port: dbPort,
  database: dbDatabase,
  connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${dbServer},${dbPort};Database=${dbDatabase};${authenticationPart};TrustServerCertificate=Yes;`,
  options: {
    trustServerCertificate: true,
    trustedConnection: useWindowsAuth
  }
};

let dbReady = false;

async function connectToDatabase() {
  try {
    await sql.connect(config);
    await sql.query(`
      IF OBJECT_ID('PasswordResetTokens', 'U') IS NULL
      BEGIN
        CREATE TABLE PasswordResetTokens (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          UserId INT NOT NULL,
          TokenHash NVARCHAR(64) NOT NULL,
          ExpiresAt DATETIME NOT NULL,
          UsedAt DATETIME NULL,
          CONSTRAINT FK_PasswordResetTokens_Users FOREIGN KEY (UserId) REFERENCES Users(Id)
        );
      END
    `);
    await sql.query(`
      IF COL_LENGTH('Candidates', 'DateOfBirth') IS NULL ALTER TABLE Candidates ADD DateOfBirth DATE NULL;
      IF COL_LENGTH('Candidates', 'Designation') IS NULL ALTER TABLE Candidates ADD Designation NVARCHAR(150) NULL;
      IF COL_LENGTH('Candidates', 'Address') IS NULL ALTER TABLE Candidates ADD Address NVARCHAR(500) NULL;
      IF COL_LENGTH('Candidates', 'YearsOfExperience') IS NULL ALTER TABLE Candidates ADD YearsOfExperience DECIMAL(5, 2) NULL;
      IF COL_LENGTH('Candidates', 'HigherQualification') IS NULL ALTER TABLE Candidates ADD HigherQualification NVARCHAR(150) NULL;
      IF COL_LENGTH('Candidates', 'ResumeFileName') IS NULL ALTER TABLE Candidates ADD ResumeFileName NVARCHAR(255) NULL;
      IF COL_LENGTH('Candidates', 'ResumeContent') IS NULL ALTER TABLE Candidates ADD ResumeContent VARBINARY(MAX) NULL;
      IF COL_LENGTH('Candidates', 'ResumeContentType') IS NULL ALTER TABLE Candidates ADD ResumeContentType NVARCHAR(100) NULL;
    `);
    dbReady = true;
    console.log('SQL Server connected successfully');
  } catch (error) {
    console.error('SQL Server connection failed:', error.message);
    dbReady = false;
  }
}

connectToDatabase();

async function extractResumeText(file) {
  if (file.mimetype === 'application/pdf') {
    const result = await pdfParse(file.buffer);
    return result.text;
  }

  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  return file.buffer.toString('utf8');
}

const mobileInterviewQuestions = [
  'How many years of professional experience do you have?',
  'What is your primary area of experience: Backend Development, Frontend Development, Full Stack Development, or QA Engineering?',
  'What is your current location?',
  'Are you comfortable relocating if the position requires it?',
  'What is your current CTC?',
  'What are your expected salary expectations?',
  'We would like to schedule your interview for tomorrow at 11 AM. Would you be comfortable with that time?'
];

async function updateCandidateStatusById(candidateId, status) {
  const request = new sql.Request();
  request.input('id', sql.Int, candidateId);
  request.input('status', sql.NVarChar(50), status);
  await request.query('UPDATE Candidates SET Status = @status WHERE Id = @id');
}

async function saveVoiceTranscript(candidateId, transcript, outcome) {
  const request = new sql.Request();
  request.input('candidateId', sql.Int, candidateId);
  request.input('transcript', sql.NVarChar(sql.MAX), transcript || null);
  request.input('outcome', sql.NVarChar(100), outcome || null);
  await request.query(`
    INSERT INTO VoiceCallLogs (CandidateId, Transcript, Outcome)
    VALUES (@candidateId, @transcript, @outcome)
  `);
}

function findResumeValue(text, labels) {
  const pattern = new RegExp(`(?:${labels.join('|')})\\s*[:\\-]\\s*([^\\n\\r]+)`, 'i');
  return text.match(pattern)?.[1]?.trim() || '';
}

function findResumeSectionValue(text, labels) {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const sectionPattern = new RegExp(`^(?:${labels.join('|')})(?:\\s*[:\\-]\\s*(.*))?$`, 'i');
  const sectionIndex = lines.findIndex((line) => sectionPattern.test(line));

  if (sectionIndex === -1) {
    return '';
  }

  const sectionMatch = lines[sectionIndex].match(sectionPattern);
  if (sectionMatch?.[1]?.trim()) {
    return sectionMatch[1].trim();
  }

  const sectionHeadings = /^(experience|work experience|employment|skills|technical skills|projects|certifications|achievements|references|personal details|contact|objective|summary)$/i;
  const values = [];
  for (const line of lines.slice(sectionIndex + 1)) {
    if (sectionHeadings.test(line)) {
      break;
    }

    values.push(line);
    if (values.length === 4) {
      break;
    }
  }

  return values.join(', ');
}

function extractQualification(text) {
  const qualifications = [
    { pattern: /\bM\s*\.??\s*Tech\b/i, value: 'M.Tech' },
    { pattern: /\bB\s*\.??\s*Tech\b/i, value: 'B.Tech' },
    { pattern: /\bM\s*\.??\s*E\b/i, value: 'M.E' },
    { pattern: /\bB\s*\.??\s*E\b/i, value: 'B.E' },
    { pattern: /\bM\s*\.??\s*CA\b/i, value: 'MCA' },
    { pattern: /\bB\s*\.??\s*CA\b/i, value: 'BCA' },
    { pattern: /\bM\s*\.??\s*BA\b/i, value: 'MBA' },
    { pattern: /\bB\s*\.??\s*BA\b/i, value: 'BBA' },
    { pattern: /\bM\s*\.??\s*Sc\b/i, value: 'M.Sc' },
    { pattern: /\bB\s*\.??\s*Sc\b/i, value: 'B.Sc' },
    { pattern: /\bPh\s*\.??\s*D\b/i, value: 'Ph.D' },
    { pattern: /\bDiploma\b/i, value: 'Diploma' }
  ];

  return qualifications.find((qualification) => qualification.pattern.test(text))?.value || '';
}

function extractDesignation(text) {
  const roles = [
    'Backend Developer',
    'QA Engineer',
    'Frontend Developer',
    'Full Stack Developer'
  ];
  const rolePattern = new RegExp(`\\b(${roles.join('|')})\\b`, 'i');
  return text.match(rolePattern)?.[1] || '';
}

function extractAddress(text) {
  const directAddress = text.match(/\b(?:sector|plot|road|street|nagar|block|phase|flat|apartment|lane|colony)\s+[^\n]{2,120}?(?:\bIndia\b|\bKarnataka\b|\bDelhi\b|\bMaharashtra\b|\bUttar Pradesh\b)/i)?.[0]?.trim() || '';
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const addressCandidates = lines.filter((line) => {
    const looksLikeLocation = /\b\d{6}\b/.test(line) || /,\s*(?:India|Karnataka|Delhi|Maharashtra|Uttar Pradesh)\b/i.test(line);
    const looksLikeEmploymentDate = /\b(?:present|current|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|20\d{2})\b/i.test(line);
    return looksLikeLocation && !/@/.test(line) && !looksLikeEmploymentDate;
  });

  const rankedAddress = addressCandidates.sort((first, second) => {
    const score = (line) => {
      let value = 0;
      if (/\b(?:sector|road|street|nagar|block|phase|flat|apartment|lane|colony)\b/i.test(line)) value += 3;
      if (/\b\d{6}\b/.test(line)) value += 2;
      if (/\b(?:karnataka|uttar pradesh|delhi|maharashtra|haryana)\b/i.test(line)) value += 1;
      return value;
    };

    return score(second) - score(first);
  })[0] || '';

  return directAddress || rankedAddress;
}

function parseResumeDetails(text, fileName = '') {
  const cleanText = text.replace(/\r/g, '');
  const lines = cleanText.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const labeledName = findResumeValue(cleanText, ['full name', 'candidate name']);
  const fileStem = fileName.replace(/\.[^.]+$/, '');
  const fileNameParts = fileStem.split(/\s*-\s*/);
  const fileNameFallback = fileNameParts[0]
    .replace(/[_-]+/g, ' ')
    .replace(/\b(resume|cv|curriculum vitae)\b/gi, '')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const fileDesignationFallback = fileNameParts.slice(1).join(' - ').trim();
  const designationFromResume = extractDesignation(cleanText);
  const contactPattern = /@|\d{4,}|,|resume|curriculum vitae|objective|experience|education/i;
  const readableNameLine = lines.find((line) => {
    const words = line.split(/\s+/);
    return words.length >= 1 && words.length <= 4 && !contactPattern.test(line) && /^[A-Za-z .'-]+$/.test(line);
  });
  const roleLine = lines.find((line) => extractDesignation(line) && !/@/.test(line) && !/\d{4,}/.test(line));
  const roleLineName = roleLine
    ? roleLine.replace(new RegExp(`\\s*[-|,]?\\s*${extractDesignation(roleLine)}\\s*$`, 'i'), '').trim()
    : '';
  const fullName = labeledName || roleLineName || readableNameLine || fileNameFallback || '';
  const nameWithoutDesignation = fullName.replace(new RegExp(`\\s*[-|,]?\\s*${extractDesignation(fullName)}\\s*$`, 'i'), '').trim();
  const nameParts = nameWithoutDesignation.split(/\s+/);
  const email = cleanText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const phone = cleanText.match(/(?:\+?\d[\d\s().-]{8,}\d)/)?.[0]?.trim() || '';
  const experience = cleanText.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of\s+experience)?/i)?.[1] || '';

  return {
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' '),
    email,
    phone,
    dateOfBirth: findResumeValue(cleanText, ['date of birth', 'dob']),
    designation: findResumeValue(cleanText, ['designation', 'job title', 'role']) || designationFromResume || fileDesignationFallback,
    address: findResumeValue(cleanText, ['address', 'location']) || extractAddress(cleanText),
    yearsOfExperience: experience,
    higherQualification: extractQualification(cleanText),
    rawText: cleanText.slice(0, 2000)
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: dbReady ? 'connected' : 'not connected'
  });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const request = new sql.Request();
    request.input('email', sql.NVarChar(150), email);
    const result = await request.query(`
      SELECT TOP 1 Id, Name, Email, PasswordHash, Role
      FROM Users
      WHERE LOWER(Email) = @email
    `);
    const user = result.recordset[0];

    if (!user || !(await bcrypt.compare(password, user.PasswordHash))) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    res.json({
      user: {
        id: user.Id,
        name: user.Name,
        email: user.Email,
        role: user.Role,
        company: companyName
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !email || password.length < 8) {
    return res.status(400).json({ message: 'Name, email, and a password of at least 8 characters are required.' });
  }

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const request = new sql.Request();
    request.input('name', sql.NVarChar(100), name);
    request.input('email', sql.NVarChar(150), email);
    request.input('passwordHash', sql.NVarChar(255), passwordHash);
    const result = await request.query(`
      INSERT INTO Users (Name, Email, PasswordHash, Role)
      OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.Email, INSERTED.Role
      VALUES (@name, @email, @passwordHash, 'HR')
    `);
    const user = result.recordset[0];

    res.status(201).json({
      user: {
        id: user.Id,
        name: user.Name,
        email: user.Email,
        role: user.Role,
        company: companyName
      }
    });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim();

  if (!email) {
    return res.status(400).json({ message: 'Enter your work email to continue.' });
  }

  if (!mailConfigured) {
    return res.status(503).json({ message: 'Recovery email is not configured. Add SMTP settings to server/.env.' });
  }

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const request = new sql.Request();
    request.input('email', sql.NVarChar(150), email.toLowerCase());
    const result = await request.query('SELECT TOP 1 Id, Email FROM Users WHERE LOWER(Email) = @email');
    const user = result.recordset[0];

    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const tokenRequest = new sql.Request();
      tokenRequest.input('userId', sql.Int, user.Id);
      tokenRequest.input('tokenHash', sql.NVarChar(64), tokenHash);
      await tokenRequest.query(`
        INSERT INTO PasswordResetTokens (UserId, TokenHash, ExpiresAt)
        VALUES (@userId, @tokenHash, DATEADD(MINUTE, 30, GETDATE()))
      `);

      const resetLink = `${appUrl}/?reset=${resetToken}`;
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: user.Email,
        subject: 'Reset your HR Voice Scheduler password',
        text: `Reset your password using this link. It expires in 30 minutes: ${resetLink}`,
        html: `<p>Reset your HR Voice Scheduler password using the link below.</p><p><a href="${resetLink}">Reset password</a></p><p>This link expires in 30 minutes.</p>`
      });
    }

    res.json({ message: 'If an account exists for that email, a password reset link has been sent.' });
  } catch (error) {
    console.error('Password recovery email failed:', error.message);
    res.status(500).json({ message: 'The recovery email could not be sent. Check the SMTP settings.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');

  if (!token || password.length < 8) {
    return res.status(400).json({ message: 'A valid reset link and a password of at least 8 characters are required.' });
  }

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const request = new sql.Request();
    request.input('tokenHash', sql.NVarChar(64), tokenHash);
    const result = await request.query(`
      SELECT TOP 1 Id, UserId
      FROM PasswordResetTokens
      WHERE TokenHash = @tokenHash AND UsedAt IS NULL AND ExpiresAt > GETDATE()
    `);
    const resetToken = result.recordset[0];

    if (!resetToken) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const updateRequest = new sql.Request();
    updateRequest.input('userId', sql.Int, resetToken.UserId);
    updateRequest.input('passwordHash', sql.NVarChar(255), passwordHash);
    updateRequest.input('tokenId', sql.Int, resetToken.Id);
    await updateRequest.query(`
      UPDATE Users SET PasswordHash = @passwordHash WHERE Id = @userId;
      UPDATE PasswordResetTokens SET UsedAt = GETDATE() WHERE Id = @tokenId;
    `);

    res.json({ message: 'Password updated successfully. You can now sign in.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/candidates', async (req, res) => {
  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const result = await sql.query(`
      SELECT Id, FirstName, LastName, Phone, Email, DateOfBirth, Designation,
             Address, YearsOfExperience, HigherQualification, ResumeFileName,
             Status, CreatedAt
      FROM Candidates
      ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/candidates/parse-resume', resumeUpload.single('resume'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Upload a PDF, DOCX, or TXT resume.' });
  }

  try {
    const text = await extractResumeText(req.file);
    const details = parseResumeDetails(text, req.file.originalname);
    res.json({
      fileName: req.file.originalname,
      resumeData: req.file.buffer.toString('base64'),
      resumeContentType: req.file.mimetype,
      details
    });
  } catch (error) {
    res.status(422).json({ message: 'The resume could not be read. Please check the file and try again.' });
  }
});

app.post('/api/candidates', async (req, res) => {
  const {
    firstName,
    lastName,
    phone,
    email,
    dateOfBirth,
    designation,
    address,
    yearsOfExperience,
    higherQualification,
    resumeFileName,
    resumeData,
    resumeContentType
  } = req.body;

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const request = new sql.Request();
    request.input('firstName', sql.NVarChar(100), firstName);
    request.input('lastName', sql.NVarChar(100), lastName);
    request.input('phone', sql.NVarChar(20), phone);
    request.input('email', sql.NVarChar(150), email || null);
    request.input('dateOfBirth', sql.Date, dateOfBirth || null);
    request.input('designation', sql.NVarChar(150), designation || null);
    request.input('address', sql.NVarChar(500), address || null);
    request.input('yearsOfExperience', sql.Decimal(5, 2), yearsOfExperience || null);
    request.input('higherQualification', sql.NVarChar(150), higherQualification || null);
    request.input('resumeFileName', sql.NVarChar(255), resumeFileName || null);
    request.input('resumeContent', sql.VarBinary(sql.MAX), resumeData ? Buffer.from(resumeData, 'base64') : null);
    request.input('resumeContentType', sql.NVarChar(100), resumeContentType || null);

    const result = await request.query(`
      INSERT INTO Candidates (FirstName, LastName, Phone, Email, DateOfBirth, Designation, Address, YearsOfExperience, HigherQualification, ResumeFileName, ResumeContent, ResumeContentType, Status)
      VALUES (@firstName, @lastName, @phone, @email, @dateOfBirth, @designation, @address, @yearsOfExperience, @higherQualification, @resumeFileName, @resumeContent, @resumeContentType, 'New')
    `);

    res.status(201).json({
      message: 'Candidate created successfully',
      affectedRows: result.rowsAffected[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/candidates/:id', async (req, res) => {
  const candidateId = Number(req.params.id);
  const {
    firstName,
    lastName,
    phone,
    email,
    status,
    dateOfBirth,
    designation,
    address,
    yearsOfExperience,
    higherQualification,
    resumeFileName,
    resumeData,
    resumeContentType
  } = req.body;

  if (!Number.isInteger(candidateId) || !firstName || !lastName || !phone) {
    return res.status(400).json({ message: 'Candidate id, first name, last name, and phone are required.' });
  }

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const request = new sql.Request();
    request.input('id', sql.Int, candidateId);
    request.input('firstName', sql.NVarChar(100), firstName);
    request.input('lastName', sql.NVarChar(100), lastName);
    request.input('phone', sql.NVarChar(20), phone);
    request.input('email', sql.NVarChar(150), email || null);
    request.input('status', sql.NVarChar(50), status || 'New');
    request.input('dateOfBirth', sql.Date, dateOfBirth || null);
    request.input('designation', sql.NVarChar(150), designation || null);
    request.input('address', sql.NVarChar(500), address || null);
    request.input('yearsOfExperience', sql.Decimal(5, 2), yearsOfExperience || null);
    request.input('higherQualification', sql.NVarChar(150), higherQualification || null);
    request.input('resumeFileName', sql.NVarChar(255), resumeFileName || null);
    request.input('resumeContent', sql.VarBinary(sql.MAX), resumeData ? Buffer.from(resumeData, 'base64') : null);
    request.input('resumeContentType', sql.NVarChar(100), resumeContentType || null);

    const result = await request.query(`
      UPDATE Candidates
      SET FirstName = @firstName,
          LastName = @lastName,
          Phone = @phone,
          Email = @email,
          Status = @status,
          DateOfBirth = @dateOfBirth,
          Designation = @designation,
          Address = @address,
          YearsOfExperience = @yearsOfExperience,
          HigherQualification = @higherQualification,
          ResumeFileName = COALESCE(@resumeFileName, ResumeFileName),
          ResumeContent = COALESCE(@resumeContent, ResumeContent),
          ResumeContentType = COALESCE(@resumeContentType, ResumeContentType)
      WHERE Id = @id
    `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Candidate not found' });
    }

    res.json({ message: 'Candidate updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/candidates/:id', async (req, res) => {
  const candidateId = Number(req.params.id);

  if (!Number.isInteger(candidateId)) {
    return res.status(400).json({ message: 'A valid candidate id is required.' });
  }

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const request = new sql.Request();
    request.input('id', sql.Int, candidateId);

    const result = await request.query('DELETE FROM Candidates WHERE Id = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Candidate not found' });
    }

    res.json({ message: 'Candidate deleted successfully' });
  } catch (error) {
    if (error.number === 547) {
      return res.status(409).json({ message: 'This candidate has related interview or voice records and cannot be deleted.' });
    }

    res.status(500).json({ error: error.message });
  }
});

app.post('/api/voice/call', async (req, res) => {
  const candidateId = Number(req.body.candidateId);

  if (!twilioConfigured) {
    return res.status(503).json({ message: 'Mobile calling is not configured. Add Twilio settings to server/.env.' });
  }

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const request = new sql.Request();
    request.input('id', sql.Int, candidateId);
    const result = await request.query('SELECT TOP 1 Id, FirstName, Phone, Designation FROM Candidates WHERE Id = @id');
    const candidate = result.recordset[0];

    if (!candidate) {
      return res.status(404).json({ message: 'Candidate not found' });
    }

    const call = await twilioClient.calls.create({
      to: candidate.Phone,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${publicApiUrl}/api/twilio/voice?candidateId=${candidate.Id}`,
      method: 'POST'
    });
    await updateCandidateStatusById(candidate.Id, 'Call in progress');

    res.status(201).json({ message: `Calling ${candidate.FirstName}`, callSid: call.sid });
  } catch (error) {
    res.status(502).json({ message: 'The mobile call could not be started.', error: error.message });
  }
});

app.post('/api/twilio/voice', async (req, res) => {
  const candidateId = Number(req.query.candidateId);
  const response = new twilio.twiml.VoiceResponse();

  try {
    const request = new sql.Request();
    request.input('id', sql.Int, candidateId);
    const result = await request.query('SELECT TOP 1 FirstName, Designation FROM Candidates WHERE Id = @id');
    const candidate = result.recordset[0];

    if (!candidate) {
      response.say('We could not find your candidate record. Goodbye.');
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    const greeting = `Hi ${candidate.FirstName}, this is an HR assistant from ${companyName} calling regarding your ${candidate.Designation || 'job'} application. Is this a good time to talk for a couple of minutes?`;
    const gather = response.gather({
      input: 'speech',
      action: `${publicApiUrl}/api/twilio/voice/answer?candidateId=${candidateId}&step=0`,
      method: 'POST',
      speechTimeout: 'auto'
    });
    gather.say(greeting);
    response.say('We did not hear a response. Goodbye.');
    response.hangup();
  } catch (error) {
    response.say('There was a technical problem. Goodbye.');
    response.hangup();
  }

  res.type('text/xml').send(response.toString());
});

app.post('/api/twilio/voice/answer', async (req, res) => {
  const candidateId = Number(req.query.candidateId);
  const step = Number(req.query.step);
  const transcript = String(req.body.SpeechResult || '').trim();
  const answer = transcript.toLowerCase();
  const response = new twilio.twiml.VoiceResponse();

  try {
    if (!transcript) {
      await updateCandidateStatusById(candidateId, step === 0 ? 'Call not answered' : 'No response');
      response.say('We did not hear a response. Goodbye.');
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    await saveVoiceTranscript(candidateId, transcript, 'Mobile interview in progress');

    if (step === 0 && !/yes|sure|okay|fine|good/i.test(answer)) {
      await updateCandidateStatusById(candidateId, 'Available date requested');
      const gather = response.gather({ input: 'speech', action: `${publicApiUrl}/api/twilio/voice/answer?candidateId=${candidateId}&step=-1`, method: 'POST', speechTimeout: 'auto' });
      gather.say('No problem. What would be a convenient time for you?');
      response.say('We did not hear a response. Goodbye.');
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    if (step === -1) {
      await updateCandidateStatusById(candidateId, 'Available date received');
      await saveVoiceTranscript(candidateId, transcript, 'Available date received');
      response.say(`Thank you. I have noted ${transcript} as your convenient time. HR will follow up with the interview details.`);
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    const questionIndex = step - 1;
    if (questionIndex === mobileInterviewQuestions.length - 1) {
      const scheduled = /yes|sure|okay|works|comfortable/i.test(answer);
      await updateCandidateStatusById(candidateId, scheduled ? 'Interview scheduled' : 'Available date requested');
      response.say(scheduled ? 'Great. Your interview has been scheduled for tomorrow at 11 AM. You will receive the interview details shortly. Thank you.' : 'Thank you. HR will follow up with the next available interview time.');
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    const nextQuestionIndex = questionIndex + 1;
    const gather = response.gather({
      input: 'speech',
      action: `${publicApiUrl}/api/twilio/voice/answer?candidateId=${candidateId}&step=${nextQuestionIndex + 1}`,
      method: 'POST',
      speechTimeout: 'auto'
    });
    gather.say(mobileInterviewQuestions[nextQuestionIndex]);
    response.say('We did not hear a response. Goodbye.');
    response.hangup();
  } catch (error) {
    response.say('There was a technical problem. Goodbye.');
    response.hangup();
  }

  res.type('text/xml').send(response.toString());
});

app.post('/api/interviews/schedule', async (req, res) => {
  const { candidateId, interviewerId, slotId } = req.body;

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const request = new sql.Request();
    request.input('candidateId', sql.Int, candidateId);
    request.input('interviewerId', sql.Int, interviewerId);
    request.input('slotId', sql.Int, slotId);

    const result = await request.query(`
      INSERT INTO InterviewRequests (CandidateId, InterviewerId, SlotId, Status)
      VALUES (@candidateId, @interviewerId, @slotId, 'Pending')
    `);

    res.status(201).json({
      message: 'Interview scheduled',
      affectedRows: result.rowsAffected[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/voice/log', async (req, res) => {
  const { candidateId, interviewRequestId, transcript, outcome } = req.body;

  try {
    if (!dbReady) {
      return res.status(503).json({ message: 'Database is not connected' });
    }

    const request = new sql.Request();
    request.input('candidateId', sql.Int, candidateId);
    request.input('interviewRequestId', sql.Int, interviewRequestId || null);
    request.input('transcript', sql.NVarChar(sql.MAX), transcript || null);
    request.input('outcome', sql.NVarChar(100), outcome || null);

    const result = await request.query(`
      INSERT INTO VoiceCallLogs (CandidateId, InterviewRequestId, Transcript, Outcome)
      VALUES (@candidateId, @interviewRequestId, @transcript, @outcome)
    `);

    res.status(201).json({
      message: 'Voice log saved',
      affectedRows: result.rowsAffected[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`);
});

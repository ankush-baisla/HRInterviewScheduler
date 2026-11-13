# HR Voice Assistant Scheduler

This project is a starter implementation for an HR interview scheduling system with a voice assistant flow.

## Tech Stack
- React + Vite
- Node.js + Express
- SQL Server

## Project Structure
- `client/` - React frontend
- `server/` - Express API
- `database/` - SQL schema

## Quick Start

### 1. Install dependencies

```bash
cd client && npm install
cd ../server && npm install
```

### 2. Set up SQL Server
Create a database named `HRVoiceAssistant` and run the SQL script from `database/schema.sql`.

### 3. Configure environment
Copy `server/.env.example` to `server/.env` and update values.

### 4. Start the app

```bash
cd server && npm start
cd client && npm run dev
```

## Features
- Candidate management
- Interview scheduling
- Voice assistant transcript capture
- Dashboard overview
- SQL Server persistence

## Notes
This is a starter foundation and can be extended for real telephony, Twilio, AI voice, and recruiter authentication.

CREATE DATABASE HRVoiceAssistant;
GO

USE HRVoiceAssistant;
GO

CREATE TABLE Users (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Email NVARCHAR(150) NOT NULL UNIQUE,
    PasswordHash NVARCHAR(255) NOT NULL,
    Role NVARCHAR(50) NOT NULL DEFAULT 'HR',
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE Candidates (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    FirstName NVARCHAR(100) NOT NULL,
    LastName NVARCHAR(100) NOT NULL,
    Phone NVARCHAR(20) NOT NULL,
    Email NVARCHAR(150) NULL,
    DateOfBirth DATE NULL,
    Designation NVARCHAR(150) NULL,
    Address NVARCHAR(500) NULL,
    YearsOfExperience DECIMAL(5, 2) NULL,
    HigherQualification NVARCHAR(150) NULL,
    ResumeFileName NVARCHAR(255) NULL,
    ResumeContent VARBINARY(MAX) NULL,
    ResumeContentType NVARCHAR(100) NULL,
    Status NVARCHAR(50) NOT NULL DEFAULT 'New',
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE Interviewers (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Email NVARCHAR(150) NOT NULL UNIQUE,
    Phone NVARCHAR(20) NULL,
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE InterviewSlots (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    InterviewerId INT NOT NULL,
    SlotDate DATETIME NOT NULL,
    DurationMinutes INT NOT NULL DEFAULT 30,
    Status NVARCHAR(50) NOT NULL DEFAULT 'Available',
    CONSTRAINT FK_InterviewSlots_Interviewers FOREIGN KEY (InterviewerId) REFERENCES Interviewers(Id)
);

CREATE TABLE InterviewRequests (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    CandidateId INT NOT NULL,
    InterviewerId INT NOT NULL,
    SlotId INT NOT NULL,
    Status NVARCHAR(50) NOT NULL DEFAULT 'Pending',
    RequestedAt DATETIME NOT NULL DEFAULT GETDATE(),
    ConfirmedAt DATETIME NULL,
    CONSTRAINT FK_InterviewRequests_Candidates FOREIGN KEY (CandidateId) REFERENCES Candidates(Id),
    CONSTRAINT FK_InterviewRequests_Interviewers FOREIGN KEY (InterviewerId) REFERENCES Interviewers(Id),
    CONSTRAINT FK_InterviewRequests_Slots FOREIGN KEY (SlotId) REFERENCES InterviewSlots(Id)
);

CREATE TABLE VoiceCallLogs (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    CandidateId INT NOT NULL,
    InterviewRequestId INT NULL,
    CallStartedAt DATETIME NOT NULL DEFAULT GETDATE(),
    CallEndedAt DATETIME NULL,
    Transcript NVARCHAR(MAX) NULL,
    Outcome NVARCHAR(100) NULL,
    CONSTRAINT FK_VoiceCallLogs_Candidates FOREIGN KEY (CandidateId) REFERENCES Candidates(Id),
    CONSTRAINT FK_VoiceCallLogs_Requests FOREIGN KEY (InterviewRequestId) REFERENCES InterviewRequests(Id)
);

CREATE TABLE Notifications (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    CandidateId INT NOT NULL,
    Message NVARCHAR(500) NOT NULL,
    Type NVARCHAR(50) NOT NULL DEFAULT 'Reminder',
    SentAt DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_Notifications_Candidates FOREIGN KEY (CandidateId) REFERENCES Candidates(Id)
);

INSERT INTO Interviewers (Name, Email, Phone)
VALUES ('Amit Sharma', 'amit@company.com', '+919900000001');

INSERT INTO InterviewSlots (InterviewerId, SlotDate, DurationMinutes, Status)
VALUES (1, DATEADD(DAY, 1, GETDATE()), 30, 'Available');

INSERT INTO Candidates (FirstName, LastName, Phone, Email, Status)
VALUES ('Riya', 'Patel', '+919876543210', 'riya@example.com', 'New');

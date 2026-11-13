import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:5000/api';

function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('hrVoiceUser'));
    } catch {
      return null;
    }
  });
  const [candidates, setCandidates] = useState([]);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    status: 'New',
    dateOfBirth: '',
    designation: '',
    address: '',
    yearsOfExperience: '',
    higherQualification: '',
    resumeFileName: '',
    resumeData: '',
    resumeContentType: ''
  });
  const [status, setStatus] = useState({ type: 'info', message: '' });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginStatus, setLoginStatus] = useState({ type: 'info', message: '' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset') || '');
  const [authView, setAuthView] = useState(() => resetToken ? 'reset' : 'login');
  const [registerForm, setRegisterForm] = useState({ name: '', email: '', password: '' });
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isSavingCandidate, setIsSavingCandidate] = useState(false);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [deletingCandidateId, setDeletingCandidateId] = useState(null);
  const [editingCandidateId, setEditingCandidateId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [voiceText, setVoiceText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [voiceCandidate, setVoiceCandidate] = useState(null);
  const [voiceMessages, setVoiceMessages] = useState([]);
  const [voiceQuestionIndex, setVoiceQuestionIndex] = useState(-1);
  const [isInterviewActive, setIsInterviewActive] = useState(false);

  const emptyForm = {
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    status: 'New',
    dateOfBirth: '',
    designation: '',
    address: '',
    yearsOfExperience: '',
    higherQualification: '',
    resumeFileName: '',
    resumeData: '',
    resumeContentType: ''
  };

  const resetDashboardState = () => {
    window.speechSynthesis.cancel();
    setForm(emptyForm);
    setEditingCandidateId(null);
    setStatus({ type: 'info', message: '' });
    setVoiceCandidate(null);
    setVoiceMessages([]);
    setVoiceText('');
    setVoiceQuestionIndex(-1);
    setIsInterviewActive(false);
    setIsListening(false);
    setSearchTerm('');
  };

  const loadCandidates = async () => {
    setIsLoadingCandidates(true);
    try {
      const response = await axios.get(`${API_URL}/candidates`);
      setCandidates(response.data);
    } catch (error) {
      console.error('Error loading candidates:', error);
    } finally {
      setIsLoadingCandidates(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadCandidates();
    }
  }, [user]);

  const handleChange = (event) => {
    setForm({
      ...form,
      [event.target.name]: event.target.value
    });
  };

  const handleResumeUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    setIsParsingResume(true);
    setStatus({ type: 'info', message: 'Reading resume details...' });
    const uploadData = new FormData();
    uploadData.append('resume', file);

    try {
      const response = await axios.post(`${API_URL}/candidates/parse-resume`, uploadData);
      setForm({
        ...emptyForm,
        ...response.data.details,
        resumeFileName: response.data.fileName,
        resumeData: response.data.resumeData,
        resumeContentType: response.data.resumeContentType
      });
      setStatus({ type: 'success', message: 'Resume details extracted. Review them before saving.' });
    } catch (error) {
      setStatus({
        type: 'error',
        message: error.response?.data?.message || 'Resume could not be read.'
      });
    } finally {
      setIsParsingResume(false);
      event.target.value = '';
    }
  };

    const removeResumeDetails = () => {
      setForm(emptyForm);
      setEditingCandidateId(null);
      setStatus({ type: 'info', message: 'Resume and extracted candidate details removed.' });
    };

  const handleLoginChange = (event) => {
    setLoginForm({
      ...loginForm,
      [event.target.name]: event.target.value
    });
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginStatus({ type: 'info', message: '' });

    try {
      const response = await axios.post(`${API_URL}/auth/login`, loginForm);
      sessionStorage.setItem('hrVoiceUser', JSON.stringify(response.data.user));
      setCandidates([]);
      resetDashboardState();
      setUser(response.data.user);
      setLoginForm({ email: '', password: '' });
      await loadCandidates();
    } catch (error) {
      setLoginStatus({
        type: 'error',
        message: error.response?.data?.message || 'Login failed. Please try again.'
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegisterChange = (event) => {
    setRegisterForm({
      ...registerForm,
      [event.target.name]: event.target.value
    });
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    setLoginStatus({ type: 'info', message: '' });

    try {
      const response = await axios.post(`${API_URL}/auth/register`, registerForm);
      sessionStorage.setItem('hrVoiceUser', JSON.stringify(response.data.user));
      setUser(response.data.user);
      setRegisterForm({ name: '', email: '', password: '' });
    } catch (error) {
      setLoginStatus({
        type: 'error',
        message: error.response?.data?.message || 'Could not create the account.'
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const handleForgotPassword = async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    setLoginStatus({ type: 'info', message: '' });

    try {
      const response = await axios.post(`${API_URL}/auth/forgot-password`, { email: recoveryEmail });
      setLoginStatus({ type: 'success', message: response.data.message });
    } catch (error) {
      setLoginStatus({
        type: 'error',
        message: error.response?.data?.message || 'Recovery request could not be sent.'
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    setLoginStatus({ type: 'info', message: '' });

    try {
      await axios.post(`${API_URL}/auth/reset-password`, { token: resetToken, password: resetPassword });
      setResetPassword('');
      setLoginStatus({ type: 'success', message: 'Password updated. You can now sign in.' });
      setAuthView('login');
      window.history.replaceState({}, '', window.location.pathname);
    } catch (error) {
      setLoginStatus({
        type: 'error',
        message: error.response?.data?.message || 'This reset link could not be used.'
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const showAuthView = (view) => {
    setAuthView(view);
    setLoginStatus({ type: 'info', message: '' });
  };

  const handleLogout = () => {
    sessionStorage.removeItem('hrVoiceUser');
    setUser(null);
    setCandidates([]);
    resetDashboardState();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const requiredFields = ['firstName', 'lastName', 'phone'];
    const missingField = requiredFields.find((field) => !String(form[field] || '').trim());

    if (missingField) {
      setStatus({
        type: 'error',
        message: `Please fill in ${missingField.replace(/([A-Z])/g, ' $1').toLowerCase()}.`
      });
      return;
    }

    try {
      setIsSavingCandidate(true);
      const candidateData = {
        ...form,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        status: form.status
      };

      if (editingCandidateId) {
        await axios.put(`${API_URL}/candidates/${editingCandidateId}`, candidateData);
      } else {
        await axios.post(`${API_URL}/candidates`, candidateData);
      }

      setForm(emptyForm);
      setEditingCandidateId(null);
      setStatus({
        type: 'success',
        message: editingCandidateId ? 'Candidate updated successfully.' : 'Candidate saved successfully.'
      });
      loadCandidates();
    } catch (error) {
      console.error('Error creating candidate:', error);
      setStatus({
        type: 'error',
        message: error.response?.data?.message || 'Save failed. Please start SQL Server and make sure the database is running.'
      });
    } finally {
      setIsSavingCandidate(false);
    }
  };

  const startEditing = (candidate) => {
    setEditingCandidateId(candidate.Id);
    setForm({
      firstName: candidate.FirstName,
      lastName: candidate.LastName,
      phone: candidate.Phone,
      email: candidate.Email || '',
      status: candidate.Status || 'New',
      dateOfBirth: candidate.DateOfBirth ? String(candidate.DateOfBirth).slice(0, 10) : '',
      designation: candidate.Designation || '',
      address: candidate.Address || '',
      yearsOfExperience: candidate.YearsOfExperience || '',
      higherQualification: candidate.HigherQualification || '',
      resumeFileName: candidate.ResumeFileName || ''
    });
    setStatus({ type: 'info', message: `Editing ${candidate.FirstName} ${candidate.LastName}.` });
  };

  const cancelEditing = () => {
    setEditingCandidateId(null);
    setForm(emptyForm);
    setStatus({ type: 'info', message: '' });
  };

  const deleteCandidate = async (candidate) => {
    if (!window.confirm(`Delete ${candidate.FirstName} ${candidate.LastName}?`)) {
      return;
    }

    try {
      setDeletingCandidateId(candidate.Id);
      await axios.delete(`${API_URL}/candidates/${candidate.Id}`);
      setStatus({ type: 'success', message: 'Candidate deleted successfully.' });
      loadCandidates();
    } catch (error) {
      setStatus({
        type: 'error',
        message: error.response?.data?.message || 'Candidate could not be deleted.'
      });
    } finally {
      setDeletingCandidateId(null);
    }
  };

  const voiceQuestions = [
    'How many years of professional experience do you have?',
    'What is your primary area of experience: Backend Development, Frontend Development, Full Stack Development, or QA Engineering?',
    'What is your current location?',
    'Are you comfortable relocating if the position requires it?',
    'What is your current CTC?',
    'What are your expected salary expectations?',
    'We would like to schedule your interview for tomorrow at 11 AM. Would you be comfortable with that time?'
  ];

  const updateCandidateStatus = async (candidate, nextStatus) => {
    await axios.put(`${API_URL}/candidates/${candidate.Id}`, {
      firstName: candidate.FirstName,
      lastName: candidate.LastName,
      phone: candidate.Phone,
      email: candidate.Email || '',
      status: nextStatus,
      dateOfBirth: candidate.DateOfBirth || '',
      designation: candidate.Designation || '',
      address: candidate.Address || '',
      yearsOfExperience: candidate.YearsOfExperience || '',
      higherQualification: candidate.HigherQualification || ''
    });
    setCandidates((currentCandidates) => currentCandidates.map((item) => (
      item.Id === candidate.Id ? { ...item, Status: nextStatus } : item
    )));
  };

  const filteredCandidates = candidates.filter((candidate) => {
    const searchableText = [
      candidate.FirstName,
      candidate.LastName,
      candidate.Phone,
      candidate.Email,
      candidate.Status
    ].join(' ').toLowerCase();

    return searchableText.includes(searchTerm.toLowerCase().trim());
  });

  const speak = (text, onEnd) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => onEnd?.();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const listenForAnswer = (candidate, questionIndex) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceMessages((messages) => [...messages, { speaker: 'System', text: 'Speech recognition is not supported in this browser.' }]);
      setIsInterviewActive(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceText('Listening for the candidate...');
    };
    recognition.onend = () => setIsListening(false);

    recognition.onerror = async (event) => {
      if (event.error === 'no-speech') {
        await updateCandidateStatus(candidate, questionIndex === 0 ? 'Call not answered' : 'No response');
        setVoiceMessages((messages) => [...messages, { speaker: 'System', text: 'No response captured from the candidate.' }]);
      }
      setIsInterviewActive(false);
    };

    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceText(transcript);
      setVoiceMessages((messages) => [...messages, { speaker: 'Candidate', text: transcript }]);

      try {
        await axios.post(`${API_URL}/voice/log`, {
          candidateId: candidate.Id,
          interviewRequestId: null,
          transcript,
          outcome: questionIndex === voiceQuestions.length - 1 && /yes|sure|okay|works/i.test(transcript)
            ? 'Interview scheduled'
            : 'Interview in progress'
        });
      } catch (error) {
        console.error('Error saving voice log:', error);
      }

      handleVoiceAnswer(candidate, questionIndex, transcript);
    };

    recognition.start();
  };

  const handleVoiceAnswer = async (candidate, questionIndex, transcript) => {
    const answer = transcript.toLowerCase();

    if (questionIndex === 0 && !/yes|sure|okay|fine|good/i.test(answer)) {
      await updateCandidateStatus(candidate, 'Available date requested');
      setVoiceMessages((messages) => [...messages, { speaker: 'HR Assistant', text: 'No problem. What would be a convenient time for you?' }]);
      speak('No problem. What would be a convenient time for you?', () => listenForAnswer(candidate, -1));
      setVoiceQuestionIndex(-1);
      return;
    }

    if (questionIndex === -1) {
      await updateCandidateStatus(candidate, 'Available date received');
      const callbackMessage = `Thank you. I have noted ${transcript} as your convenient time. HR will follow up with the interview details.`;
      setVoiceMessages((messages) => [...messages, { speaker: 'HR Assistant', text: callbackMessage }]);
      speak(callbackMessage);
      setIsInterviewActive(false);
      return;
    }

    if (questionIndex === voiceQuestions.length - 1) {
      const scheduled = /yes|sure|okay|works|comfortable/i.test(answer);
      await updateCandidateStatus(candidate, scheduled ? 'Interview scheduled' : 'Available date requested');
      const closingMessage = scheduled
        ? 'Great. Your interview has been scheduled for tomorrow at 11 AM. You will receive the interview details shortly. Thank you.'
        : 'Thank you. HR will follow up with the next available interview time.';
      setVoiceMessages((messages) => [...messages, { speaker: 'HR Assistant', text: closingMessage }]);
      speak(closingMessage);
      setIsInterviewActive(false);
      return;
    }

    const nextIndex = questionIndex + 1;
    setVoiceQuestionIndex(nextIndex);
    setVoiceMessages((messages) => [...messages, { speaker: 'HR Assistant', text: voiceQuestions[nextIndex] }]);
    speak(voiceQuestions[nextIndex], () => listenForAnswer(candidate, nextIndex));
  };

  const startVoiceInterview = async (candidate) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceMessages([{ speaker: 'System', text: 'Speech recognition is not supported in this browser.' }]);
      setVoiceCandidate(candidate);
      return;
    }

    setVoiceCandidate(candidate);
    setVoiceMessages([]);
    setVoiceText('');
    setVoiceQuestionIndex(0);
    setIsInterviewActive(true);
    await updateCandidateStatus(candidate, 'Call in progress');

    const greeting = `Hi ${candidate.FirstName}, this is ${user.name} from ${user.company || 'HR Voice Scheduler'} calling regarding your ${candidate.Designation || 'job'} application. Is this a good time to talk for a couple of minutes?`;
    setVoiceMessages([{ speaker: 'HR Assistant', text: greeting }]);
    speak(greeting, () => listenForAnswer(candidate, 0));
  };

  const stopVoiceInterview = () => {
    window.speechSynthesis.cancel();
    setIsInterviewActive(false);
    setIsListening(false);
  };

  const callCandidatePhone = async () => {
    if (!voiceCandidate?.Phone) {
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/voice/call`, { candidateId: voiceCandidate.Id });
      setVoiceMessages((messages) => [...messages, { speaker: 'System', text: response.data.message }]);
      setStatus({ type: 'success', message: `Mobile assistant call started for ${voiceCandidate.FirstName}.` });
    } catch (error) {
      setStatus({ type: 'error', message: error.response?.data?.message || 'Mobile call could not be started.' });
    }
  };

  if (!user) {
    return (
      <main className="login-shell">
        {(isLoggingIn || authBusy) && (
          <div className="loading-overlay" role="status" aria-live="polite">
            <div className="loading-card">
              <span className="loading-spinner" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <strong>{authView === 'register' ? 'Creating your workspace' : authView === 'forgot' ? 'Preparing recovery' : 'Opening your workspace'}</strong>
              <span>Connecting securely to HR records</span>
              <span className="loading-progress"><span /></span>
            </div>
          </div>
        )}
        <section className="login-visual">
          <div className="brand-mark">HV</div>
          <p className="eyebrow">HR operations workspace</p>
          <h1>Make every candidate conversation count.</h1>
          <p className="login-intro">
            A focused command center for candidate records, interview scheduling, and voice follow-up.
          </p>
          <figure className="login-image-frame">
            <img
              src="https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=85"
              alt="HR team collaborating around a table"
            />
            <figcaption><span />People-first hiring</figcaption>
          </figure>
          <div className="login-stat-row">
            <div><strong>01</strong><span>Candidate intelligence</span></div>
            <div><strong>24/7</strong><span>Voice-ready workflows</span></div>
          </div>
        </section>

        <section className="login-panel">
          <div className="login-panel-top">
            <span className="panel-logo">HV</span>
            <span className="secure-pill"><span className="secure-dot" />Private workspace</span>
          </div>
          {authView === 'login' && (
            <>
              <div className="login-panel-header">
                <p className="eyebrow">Secure access</p>
                <h2>Welcome back</h2>
                <p>Sign in to your HR dashboard.</p>
              </div>
              <form className="login-form" onSubmit={handleLogin}>
                <label htmlFor="login-email">Work email</label>
                <input id="login-email" type="email" name="email" value={loginForm.email} onChange={handleLoginChange} placeholder="you@company.com" autoComplete="email" required />
                <div className="password-label-row">
                  <label htmlFor="login-password">Password</label>
                  <button type="button" className="text-button" onClick={() => showAuthView('forgot')}>Forgot password?</button>
                </div>
                <input id="login-password" type="password" name="password" value={loginForm.password} onChange={handleLoginChange} placeholder="Enter your password" autoComplete="current-password" required />
                <button type="submit" disabled={isLoggingIn}>
                  {isLoggingIn ? 'Signing in...' : 'Enter dashboard'}
                  <span aria-hidden="true">-&gt;</span>
                </button>
                {loginStatus.message && <p className={`status-message ${loginStatus.type}`}>{loginStatus.message}</p>}
              </form>
              <p className="auth-switch">New to the workspace? <button type="button" className="text-button" onClick={() => showAuthView('register')}>Create an HR account</button></p>
              <p className="login-footer">Your access is verified against the HR database.</p>
            </>
          )}

          {authView === 'register' && (
            <>
              <div className="login-panel-header">
                <p className="eyebrow">New team member</p>
                <h2>Create account</h2>
                <p>Set up your secure HR workspace access.</p>
              </div>
              <form className="login-form" onSubmit={handleRegister}>
                <label htmlFor="register-name">Full name</label>
                <input id="register-name" type="text" name="name" value={registerForm.name} onChange={handleRegisterChange} placeholder="Your name" autoComplete="name" required />
                <label htmlFor="register-email">Work email</label>
                <input id="register-email" type="email" name="email" value={registerForm.email} onChange={handleRegisterChange} placeholder="you@company.com" autoComplete="email" required />
                <label htmlFor="register-password">Password</label>
                <input id="register-password" type="password" name="password" value={registerForm.password} onChange={handleRegisterChange} placeholder="At least 8 characters" autoComplete="new-password" minLength="8" required />
                <button type="submit" disabled={authBusy}>{authBusy ? 'Creating account...' : 'Create HR account'}<span aria-hidden="true">-&gt;</span></button>
                {loginStatus.message && <p className={`status-message ${loginStatus.type}`}>{loginStatus.message}</p>}
              </form>
              <p className="auth-switch"><button type="button" className="text-button" onClick={() => showAuthView('login')}>&lt;- Back to sign in</button></p>
            </>
          )}

          {authView === 'forgot' && (
            <>
              <div className="login-panel-header">
                <p className="eyebrow">Account recovery</p>
                <h2>Find your way back</h2>
                <p>Enter your work email and your HR administrator will share the next recovery step.</p>
              </div>
              <form className="login-form" onSubmit={handleForgotPassword}>
                <label htmlFor="recovery-email">Work email</label>
                <input id="recovery-email" type="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required />
                <button type="submit" disabled={authBusy}>{authBusy ? 'Sending request...' : 'Request recovery'}<span aria-hidden="true">-&gt;</span></button>
                {loginStatus.message && <p className={`status-message ${loginStatus.type}`}>{loginStatus.message}</p>}
              </form>
              <p className="auth-switch"><button type="button" className="text-button" onClick={() => showAuthView('login')}>&lt;- Back to sign in</button></p>
            </>
          )}

          {authView === 'reset' && (
            <>
              <div className="login-panel-header">
                <p className="eyebrow">Secure recovery</p>
                <h2>Choose a new password</h2>
                <p>Use at least 8 characters to protect your HR workspace.</p>
              </div>
              <form className="login-form" onSubmit={handleResetPassword}>
                <label htmlFor="reset-password">New password</label>
                <input id="reset-password" type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="At least 8 characters" autoComplete="new-password" minLength="8" required />
                <button type="submit" disabled={authBusy}>{authBusy ? 'Updating password...' : 'Update password'}<span aria-hidden="true">-&gt;</span></button>
                {loginStatus.message && <p className={`status-message ${loginStatus.type}`}>{loginStatus.message}</p>}
              </form>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">HR system</p>
          <h1>Voice Interview Scheduler</h1>
        </div>
        <div className="user-menu">
          <div>
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
          <button type="button" className="secondary-button" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main className="grid-layout">
        <section className="card">
          <h2>{editingCandidateId ? 'Edit Candidate' : 'Add Candidate'}</h2>
          <form onSubmit={handleSubmit} className="candidate-form">
            <label className="resume-upload">
              <span className="resume-upload-icon">+</span>
              <span>
                <strong>{isParsingResume ? 'Reading resume...' : 'Upload resume'}</strong>
                <small>PDF, DOCX or TXT · up to 5 MB</small>
              </span>
              <input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={handleResumeUpload} disabled={isParsingResume} />
            </label>
            {form.resumeFileName && (
              <div className="resume-file-row">
                <p className="resume-file">Parsed from {form.resumeFileName}</p>
                <button type="button" className="remove-resume" onClick={removeResumeDetails}>Remove resume</button>
              </div>
            )}
            <input
              type="text"
              name="firstName"
              value={form.firstName}
              onChange={handleChange}
              placeholder="First Name"
            />
            <input
              type="text"
              name="lastName"
              value={form.lastName}
              onChange={handleChange}
              placeholder="Last Name"
            />
            <input
              type="text"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="Phone"
            />
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="Email"
            />
            <div className="candidate-fields-row">
              <input type="date" name="dateOfBirth" value={form.dateOfBirth} onChange={handleChange} aria-label="Date of birth" />
              <input type="text" name="designation" value={form.designation} onChange={handleChange} placeholder="Designation" />
            </div>
            <div className="candidate-fields-row">
              <input type="number" name="yearsOfExperience" value={form.yearsOfExperience} onChange={handleChange} placeholder="Years of experience" min="0" step="0.5" />
              <input type="text" name="higherQualification" value={form.higherQualification} onChange={handleChange} placeholder="Higher qualification" />
            </div>
            <textarea name="address" value={form.address} onChange={handleChange} placeholder="Address" rows="2" />
            {editingCandidateId && (
              <select name="status" value={form.status} onChange={handleChange}>
                <option value="New">New</option>
                <option value="Contacted">Contacted</option>
                <option value="Selected">Selected</option>
                <option value="Rejected">Rejected</option>
              </select>
            )}
            <div className="form-actions">
              <button type="submit" disabled={isSavingCandidate}>
                {isSavingCandidate ? 'Saving...' : editingCandidateId ? 'Update Candidate' : 'Save Candidate'}
              </button>
              {editingCandidateId && (
                <button type="button" className="secondary-button" onClick={cancelEditing}>Cancel</button>
              )}
            </div>
            {status.message && (
              <p className={`status-message ${status.type}`}>
                {status.message}
              </p>
            )}
          </form>
        </section>

        <section className="card">
          <h2>Voice Assistant</h2>
          <p className="voice-context">
            {voiceCandidate ? `${voiceCandidate.FirstName} ${voiceCandidate.LastName} · ${voiceCandidate.Phone}` : 'Double-click a candidate to begin a voice interview.'}
          </p>
          <button className="voice-button" onClick={() => voiceCandidate && startVoiceInterview(voiceCandidate)} disabled={!voiceCandidate || isInterviewActive}>
            {isListening ? 'Listening...' : isInterviewActive ? 'Interview in progress...' : 'Start Voice Interview'}
          </button>
          {voiceCandidate && (
            <button className="phone-call-button" onClick={callCandidatePhone} disabled={isInterviewActive}>
              Call assistant · {voiceCandidate.Phone}
            </button>
          )}
          {isInterviewActive && <button className="secondary-button stop-voice-button" onClick={stopVoiceInterview}>Stop interview</button>}

          <div className="voice-panel">
            <p className="label">Interview flow</p>
            {isListening && (
              <div className="live-listening" role="status" aria-live="polite">
                <span className="listening-bars"><i /><i /><i /><i /><i /></span>
                <span>Listening clearly for the candidate...</span>
              </div>
            )}
            {voiceMessages.length ? voiceMessages.map((message, index) => (
              <p className={`voice-message ${message.speaker === 'HR Assistant' ? 'assistant' : 'candidate'}`} key={`${message.speaker}-${index}`}>
                <strong>{message.speaker}</strong>{message.text}
              </p>
            )) : <p>Select a candidate from the list to start the scripted interview.</p>}
          </div>

          <div className="transcript-box">
            <p className="label">Transcript</p>
            <p>{voiceText || 'No response captured yet.'}</p>
          </div>
        </section>
      </main>

      <section className="card table-card">
        <div className="table-heading">
          <h2>Candidate List</h2>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search candidates"
            aria-label="Search candidates"
          />
        </div>
        <div className="table-scroll">
          <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Designation</th>
              <th>Experience</th>
              <th>Address</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingCandidates && (
              <tr className="loading-row">
                <td colSpan="8"><span className="table-loader" />Loading candidates from HR records...</td>
              </tr>
            )}
            {!isLoadingCandidates && filteredCandidates.map((candidate) => (
              <tr key={candidate.Id} onClick={() => setVoiceCandidate(candidate)} onDoubleClick={() => startVoiceInterview(candidate)} title="Click to select, double-click to start voice interview" className={voiceCandidate?.Id === candidate.Id ? 'selected-candidate' : ''}>
                <td>{candidate.FirstName} {candidate.LastName}</td>
                <td>{candidate.Phone}</td>
                <td>{candidate.Email || 'N/A'}</td>
                <td>{candidate.Designation || 'N/A'}</td>
                <td>{candidate.YearsOfExperience ? `${candidate.YearsOfExperience} yrs` : 'N/A'}</td>
                <td>{candidate.Address || 'N/A'}</td>
                <td>{candidate.Status}</td>
                <td className="action-buttons">
                  <button type="button" className="table-action" onClick={() => startEditing(candidate)}>Edit</button>
                  <button type="button" className="table-action danger" onClick={() => deleteCandidate(candidate)} disabled={deletingCandidateId === candidate.Id}>
                    {deletingCandidateId === candidate.Id ? 'Deleting...' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
            {!isLoadingCandidates && !filteredCandidates.length && (
              <tr>
                <td colSpan="8" className="empty-state">No candidates found.</td>
              </tr>
            )}
          </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default App;

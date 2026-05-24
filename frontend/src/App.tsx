import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { quickQuestions, type DocumentChunk, type DocumentRecord } from './data/mock';
import {
  askQuestion,
  deleteDocument,
  forgotPassword,
  getDocument,
  getDocumentPdfUrl,
  getDocumentRisks,
  getDocumentSummary,
  listDocuments,
  loginWithEmail,
  registerWithEmail,
  uploadDocument
} from './services/legaleseApi';

type Screen = 'login' | 'signup' | 'library' | 'reader';
type Language = 'English' | 'Hindi';
type RiskItem = {
  id: string;
  clause_text: string;
  title: string;
  severity: string;
  summary: string;
  category: string;
  mitigation: string;
};

const heroPoints = [
  ['Evidence-first answers', 'citation aware'],
  ['Dual language output', 'English + Hindi'],
  ['Clause risk index', 'scored insights']
];

const formatRiskTone = (risk: DocumentChunk['risk']) => {
  switch (risk) {
    case 'Critical':
      return 'border-rose-300/70 text-rose-100';
    case 'Warning':
      return 'border-amber-300/70 text-amber-100';
    case 'Low':
      return 'border-emerald-300/70 text-emerald-100';
    default:
      return 'border-slate-300/70 text-slate-100';
  }
};

// Heuristics to detect header/footer-like metadata so we can filter it from summaries
function looksLikeMetadataLine(text: string) {
  const t = (text || '').trim();
  if (!t) return true;
  // Pure numbers or simple page markers
  if (/^\d+$/.test(t)) return true;
  if (/^page\b|^pg\b/i.test(t)) return true;
  if (/^\d+\s*of\s*\d+/i.test(t)) return true;

  // Short tokens that are mostly digits/punctuation (e.g. "2 2.")
  const digits = (t.match(/\d/g) || []).length;
  if (t.length > 0 && digits / t.length > 0.45 && t.length < 40) return true;

  // Course-code like tokens (e.g., 21CSC206T) or strings mixing ALLCAPS + digits
  const compact = t.replace(/[^A-Z0-9]/gi, '');
  if (/^[A-Z0-9]{6,}$/.test(compact) && /\d/.test(compact)) return true;
  if (t.split(/\s+/).length <= 6 && /[A-Z]{2,}/.test(t) && /\d/.test(t)) return true;

  return false;
}

function sanitizeChunkText(text: string) {
  if (!text) return '';
  const lines = text.split(/(?:\r?\n)+/).map(l => l.trim()).filter(Boolean);
  const filtered = lines.filter(l => !looksLikeMetadataLine(l));
  // If everything was filtered out, fall back to the original trimmed text
  return (filtered.length ? filtered.join(' ') : lines.join(' ')).trim();
}

function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(null);
  const [language, setLanguage] = useState<Language>('English');
  const [activeChunkId, setActiveChunkId] = useState<string>('');
  const [chatOpen, setChatOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'assistant' | 'user'; text: string }>>([
    {
      role: 'assistant',
      text: 'Ask a question about the active file. Responses stay grounded in retrieved clauses.'
    }
  ]);
  const [isChatSending, setIsChatSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRiskLoading, setIsRiskLoading] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [riskItems, setRiskItems] = useState<RiskItem[]>([]);
  const [documentSummary, setDocumentSummary] = useState<{ english: string; hindi: string }>({
    english: 'Summary unavailable.',
    hindi: 'सारांश उपलब्ध नहीं है।'
  });
  const uploadRef = useRef<HTMLInputElement | null>(null);
  
  // Signup form state
  const [signupFullName, setSignupFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [signupStatus, setSignupStatus] = useState('');
  const [signupIsSubmitting, setSignupIsSubmitting] = useState(false);

  const currentChunk = useMemo(
    () => activeDocument?.chunks?.find((chunk: DocumentChunk) => chunk.id === activeChunkId) ?? activeDocument?.chunks?.[0],
    [activeChunkId, activeDocument]
  );

  useEffect(() => {
    const loadDocuments = async () => {
      try {
        const serverDocuments = await listDocuments();
        if (serverDocuments.length > 0) {
          setDocuments(serverDocuments);
          // Only auto-open if we just logged in and have docs, but user command was "delete it"
          // so we'll just populate the library but stay on library screen or whatever is current
        }
      } catch {
        return;
      }
    };

    void loadDocuments();
  }, []);

  useEffect(() => {
    const loadRiskItems = async () => {
      if (!activeDocument?.id) {
        return;
      }

      // Instant local hints from existing chunks to reduce perceived latency.
      const localRiskItems = activeDocument.chunks
        .filter((chunk) => chunk.risk === 'Critical' || chunk.risk === 'Warning')
        .slice(0, 8)
        .map((chunk) => ({
          id: chunk.id,
          clause_text: chunk.original,
          title: chunk.title,
          severity: chunk.risk,
          summary: chunk.english || 'Simplified explanation unavailable.',
          category: chunk.category || 'Legal',
          mitigation: chunk.mitigation || 'Review with legal counsel.'
        }));
      if (localRiskItems.length > 0) {
        setRiskItems(localRiskItems);
      }

      try {
        setIsRiskLoading(true);
        setRiskItems(await getDocumentRisks(activeDocument.id));
      } catch {
        setRiskItems([]);
      } finally {
        setIsRiskLoading(false);
      }
    };

    void loadRiskItems();
  }, [activeDocument?.id]);

  useEffect(() => {
    const loadSummary = async () => {
      if (!activeDocument?.id) {
        return;
      }

      try {
        setDocumentSummary(await getDocumentSummary(activeDocument.id));
      } catch {
        // Backend summary failed — build a chunk-based fallback so no content is skipped.
        const maxBullets = 8;
        const bulletsEnglish = activeDocument.chunks
          .slice(0, maxBullets)
          .map((c) => sanitizeChunkText(c.english || c.original || ''))
          .filter(Boolean)
          .map((t) => `• ${t}`)
          .join('\n');

        const bulletsHindi = activeDocument.chunks
          .slice(0, maxBullets)
          .map((c) => sanitizeChunkText(c.hindi || c.english || c.original || ''))
          .filter(Boolean)
          .map((t) => `• ${t}`)
          .join('\n');

        setDocumentSummary({ english: bulletsEnglish || 'Summary unavailable.', hindi: bulletsHindi || 'सारांश उपलब्ध नहीं है।' });
      }
    };

    void loadSummary();
  }, [activeDocument?.id]);

  const selectDocument = (document: DocumentRecord) => {
    setActiveDocument(document);
    setActiveChunkId(document.chunks?.[0]?.id ?? '');
    setScreen('reader');
  };

  const handleUpload = async (file: File | null) => {
    if (!file) {
      return;
    }

    setIsUploading(true);
    try {
      const uploadedDocument = await uploadDocument(file);

      // Add to list immediately with processing status
      setDocuments((currentDocuments: DocumentRecord[]) => [
        uploadedDocument,
        ...currentDocuments.filter((doc) => doc.id !== uploadedDocument.id)
      ]);

      // Start polling
      let currentStatus = uploadedDocument.status;
      let finalDoc = uploadedDocument;

      // Poll up to 30 times (1 minute)
      for (let i = 0; i < 30; i++) {
        if (currentStatus === 'completed' || currentStatus === 'failed') break;
        
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s
        
        const updated = await getDocument(uploadedDocument.id);
        if (updated) {
          finalDoc = updated;
          currentStatus = updated.status;
          
          // Update the list with fresh data
          setDocuments((currentDocs) => 
            currentDocs.map(doc => doc.id === finalDoc.id ? finalDoc : doc)
          );
        }
      }

      if (currentStatus === 'completed') {
        selectDocument(finalDoc);
      } else if (currentStatus === 'failed') {
        alert("Background analysis failed. You can still read the document, but AI features may be limited.");
        selectDocument(finalDoc);
      } else {
        alert("Analysis is taking longer than expected. You can find it in your library once finished.");
      }

    } catch (error) {
      alert("Failed to upload document. Please check backend logs.");
    } finally {
      setIsUploading(false);
      if (uploadRef.current) {
        uploadRef.current.value = '';
      }
    }
  };

  const sendChatQuestion = async (question: string) => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !activeDocument) {
      return;
    }

    setChatMessages((messages) => [...messages, { role: 'user', text: trimmedQuestion }]);
    setIsChatSending(true);

    try {
      const payload = await askQuestion(activeDocument.id, trimmedQuestion, language);
      setChatMessages((messages) => [...messages, { role: 'assistant', text: payload.answer }]);
      setQuery('');
    } catch {
      setChatMessages((messages) => [...messages, { role: 'assistant', text: 'I cannot find that in the Document.' }]);
    } finally {
      setIsChatSending(false);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    setDeletingDocumentId(documentId);
    try {
      await deleteDocument(documentId);
      setDocuments((currentDocuments) => currentDocuments.filter((doc) => doc.id !== documentId));

      if (activeDocument?.id === documentId) {
        setActiveDocument(null);
        setActiveChunkId('');
        setScreen('library');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete document.';

      // If the backend returns 405 (Method Not Allowed) or 404 (Not Found),
      // remove from UI so users are not blocked by stale records or limited server features.
      if (message.includes('(405)') || message.includes('(404)')) {
        setDocuments((currentDocuments) => currentDocuments.filter((doc) => doc.id !== documentId));
        if (activeDocument?.id === documentId) {
          setActiveDocument(null);
          setActiveChunkId('');
          setScreen('library');
        }
        return;
      }

      alert(message);
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const handleSignup = async () => {
    // Validate signup form
    if (!signupFullName.trim()) {
      setSignupStatus('Please enter your full name.');
      return;
    }

    if (!signupEmail.trim()) {
      setSignupStatus('Please enter a valid email address.');
      return;
    }

    if (signupPassword.length < 6) {
      setSignupStatus('Password must be at least 6 characters long.');
      return;
    }

    if (signupPassword !== signupConfirmPassword) {
      setSignupStatus('Passwords do not match.');
      return;
    }

    setSignupIsSubmitting(true);
    try {
      const payload = await registerWithEmail(signupEmail.trim(), signupPassword, signupFullName.trim() || undefined);
      setSignupStatus(payload.message);

      // Navigate to library when registered
      setScreen('library');
      // Reset form state
      setSignupFullName('');
      setSignupEmail('');
      setSignupPassword('');
      setSignupConfirmPassword('');
      setSignupStatus('');
    } catch (error) {
      setSignupStatus(error instanceof Error ? error.message : 'Account creation failed. Please try again.');
    } finally {
      setSignupIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell bg-[var(--bg)] text-[var(--text)]">
      <AnimatePresence mode="wait">
        {screen === 'login' ? (
          <motion.div
            key="login"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.35 }}
            className="min-h-screen"
          >
            <LoginScreen 
              onContinue={() => setScreen('library')}
              onCreateAccount={() => setScreen('signup')}
            />
          </motion.div>
        ) : screen === 'signup' ? (
          <motion.div
            key="signup"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.35 }}
            className="min-h-screen"
          >
            <SignupScreen
              fullName={signupFullName}
              onFullNameChange={setSignupFullName}
              email={signupEmail}
              onEmailChange={setSignupEmail}
              password={signupPassword}
              onPasswordChange={setSignupPassword}
              confirmPassword={signupConfirmPassword}
              onConfirmPasswordChange={setSignupConfirmPassword}
              status={signupStatus}
              onStatusChange={setSignupStatus}
              isSubmitting={signupIsSubmitting}
              onSubmit={handleSignup}
              onBackToLogin={() => setScreen('login')}
            />
          </motion.div>
        ) : screen === 'library' ? (
          <motion.div
            key="library"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.35 }}
            className="min-h-screen"
          >
            <LibraryScreen
              documents={documents}
              onOpenDocument={selectDocument}
              onDeleteDocument={(documentId) => void handleDeleteDocument(documentId)}
              onNewUpload={() => uploadRef.current?.click()}
              onBack={() => setScreen('login')}
              uploadRef={uploadRef}
              isUploading={isUploading}
              deletingDocumentId={deletingDocumentId}
            />
          </motion.div>
        ) : (
          <motion.div
            key="reader"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.35 }}
            className="min-h-screen"
          >
            {activeDocument && (
              <ReaderScreen
                document={activeDocument}
                language={language}
                onLanguageChange={setLanguage}
                activeChunkId={activeChunkId}
                onActiveChunkChange={setActiveChunkId}
                onBack={() => {
                setActiveDocument(null);
                setScreen('library');
              }}
                onOpenChat={() => setChatOpen((value: boolean) => !value)}
                onUpload={() => uploadRef.current?.click()}
                onDeleteDocument={() => activeDocument && void handleDeleteDocument(activeDocument.id)}
                currentChunk={currentChunk}
                riskItems={riskItems}
                isRiskLoading={isRiskLoading}
                summary={documentSummary}
                deletingDocumentId={deletingDocumentId}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <input
        ref={uploadRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          void handleUpload(event.target.files?.[0] ?? null);
        }}
      />

      <ChatBubble
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        query={query}
        setQuery={setQuery}
        messages={chatMessages}
        isSending={isChatSending}
        onSend={(question) => void sendChatQuestion(question)}
      />
    </div>
  );
}

function LoginScreen({ onContinue, onCreateAccount }: { onContinue: () => void; onCreateAccount: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEmailLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setStatus('Enter email and password to sign in.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = await loginWithEmail(email.trim(), password);
      setStatus(payload.message);
      onContinue();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sign in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setStatus('Enter your email first, then click Forgot password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = await forgotPassword(email.trim());
      setStatus(payload.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Password reset failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative flex flex-col justify-between overflow-hidden px-8 py-8 sm:px-12 lg:px-14 lg:py-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_25%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_35%)]" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-white/15 bg-white/90 text-black">
            ⚖
          </div>
          <div>
            <div className="display-font text-2xl font-semibold">Legalese</div>
            <div className="text-xs uppercase tracking-[0.28em] text-white/45">AI legal simplifier</div>
          </div>
        </div>

        <div className="relative max-w-xl pb-10 pt-10 lg:pt-0">
          <div className="mb-4 text-xs uppercase tracking-[0.32em] text-white/40">document intelligence suite</div>
          <h1 className="display-font max-w-lg text-5xl font-semibold leading-[0.95] text-white sm:text-6xl">
            Turn legal text into clear decisions.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-white/70">
            Upload agreements, surface risky language, read simplified explanations, and query your file with context-bound AI.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {heroPoints.map(([label, value]) => (
              <div key={label} className="subtle-panel rounded-2xl p-4">
                <div className="text-sm font-semibold text-white">{label}</div>
                <div className="mt-1 text-sm text-white/55">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs uppercase tracking-[0.32em] text-white/35">
          Assistant output for review support, not legal counsel.
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="glass-panel w-full max-w-md rounded-[2rem] p-7 sm:p-9">
          <div className="mb-8">
            <div className="text-xs uppercase tracking-[0.3em] text-white/45">Secure access</div>
            <h2 className="display-font mt-3 text-4xl font-semibold text-white">Open your workspace</h2>
            <p className="mt-3 text-white/60">Continue your document review session.</p>
          </div>

          <div className="space-y-4">
            <label className="block text-xs uppercase tracking-[0.28em] text-white/40">Email</label>
            <input className="field" placeholder="you@firm.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />

            <label className="block text-xs uppercase tracking-[0.28em] text-white/40">Password</label>
            <input className="field" placeholder="At least 6 characters" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />

            <button className="button-strong w-full px-4 py-4" onClick={() => void handleEmailLogin()} disabled={isSubmitting}>
              {isSubmitting ? 'Please wait...' : <span>Sign in <span className="ml-2">→</span></span>}
            </button>

            <div className="flex items-center justify-between pt-2 text-sm text-white/55">
              <button className="underline decoration-white/30 underline-offset-4 hover:text-white" onClick={() => void handleForgotPassword()} disabled={isSubmitting}>Forgot password?</button>
              <button className="underline decoration-white/30 underline-offset-4 hover:text-white" onClick={onCreateAccount} disabled={isSubmitting}>Create account</button>
            </div>

            {status ? <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/75">{status}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function LibraryScreen({
  documents,
  onOpenDocument,
  onDeleteDocument,
  onNewUpload,
  onBack,
  uploadRef,
  isUploading,
  deletingDocumentId
}: {
  documents: DocumentRecord[];
  onOpenDocument: (document: DocumentRecord) => void;
  onDeleteDocument: (documentId: string) => void;
  onNewUpload: () => void;
  onBack: () => void;
  uploadRef: React.RefObject<HTMLInputElement | null>;
  isUploading: boolean;
  deletingDocumentId: string | null;
}) {
  return (
    <div className="min-h-screen px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
      <header className="glass-panel sticky top-4 z-20 flex items-center justify-between rounded-[1.5rem] px-4 py-3 sm:px-5">
        <button className="flex items-center gap-3 text-left" onClick={onBack}>
          <div className="grid h-10 w-10 place-items-center rounded-md border border-white/10 bg-white/90 text-black">⚖</div>
          <div>
            <div className="display-font text-xl font-semibold">Legalese</div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-white/40">AI</div>
          </div>
        </button>

        <div className="flex items-center gap-3">
          <button className="button-strong px-5 py-3" onClick={onNewUpload}>
            {isUploading ? 'Uploading...' : '⤴ New Upload'}
          </button>
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium">Workspace User</div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-white/35">legal-team@workspace.local</div>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-10 max-w-7xl">
        <div className="flex flex-col gap-8 border-b border-white/10 pb-9 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-white/40">Library</div>
            <h1 className="display-font mt-4 text-5xl font-semibold sm:text-6xl">Document workspace.</h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-white/65">
              Files are parsed, embedded, and risk-indexed. Select any row to open the analysis reader.
            </p>
          </div>
          <button className="button-strong px-6 py-3" onClick={onNewUpload}>
            ⤴ New Upload
          </button>
        </div>

        <div className="mt-10 rounded-[2rem] border border-white/8 bg-white/[0.025] p-5 sm:p-7">
          <AnimatePresence initial={false}>
            {documents.map((document) => (
              <motion.div
                key={document.id}
                layout
                whileHover={{ y: -2 }}
                className="subtle-panel mb-4 flex w-full flex-col gap-5 rounded-[1.5rem] p-5 text-left transition sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-xs uppercase tracking-[0.28em] text-white/40">Document</div>
                  <div className="display-font mt-2 text-2xl font-semibold">{document.name}</div>
                  <div className="mt-2 text-sm text-white/55">
                    {document.pages} pages · uploaded {document.uploadedAt}
                  </div>
                </div>
                <div className="flex items-center gap-3 self-start">
                  {document.status === 'processing' ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/50">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400"></span>
                      Analyzing...
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
                      <span className="text-white">Risk score</span>
                      <span className="display-font ml-2 text-3xl text-white">{document.riskScore}</span>
                      <span>/100</span>
                    </div>
                  )}
                  <button className="button-soft px-4 py-3 text-sm" onClick={() => onOpenDocument(document)}>
                    Open
                  </button>
                  <button
                    className="button-soft px-4 py-3 text-sm text-rose-200"
                    onClick={() => onDeleteDocument(document.id)}
                    disabled={deletingDocumentId === document.id}
                  >
                    {deletingDocumentId === document.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {documents.length === 0 ? (
            <div className="grid min-h-[34rem] place-items-center rounded-[2rem] border border-dashed border-white/10 bg-white/[0.02]">
              <div className="text-center">
                <div className="display-font text-3xl font-semibold">No files in workspace</div>
                <p className="mt-3 max-w-md text-white/55">
                  Upload a contract, policy, or terms document to start analysis.
                </p>
                <button className="button-strong mt-8 px-6 py-3" onClick={() => uploadRef.current?.click()}>
                  ⤴ Upload document
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function ReaderScreen({
  document,
  language,
  onLanguageChange,
  activeChunkId,
  onActiveChunkChange,
  onBack,
  onOpenChat,
  onUpload,
  onDeleteDocument,
  currentChunk,
  riskItems,
  isRiskLoading,
  summary,
  deletingDocumentId
}: {
  document: DocumentRecord;
  language: Language;
  onLanguageChange: (language: Language) => void;
  activeChunkId: string;
  onActiveChunkChange: (chunkId: string) => void;
  onBack: () => void;
  onOpenChat: () => void;
  onUpload: () => void;
  onDeleteDocument: () => void;
  currentChunk?: DocumentChunk;
  riskItems: RiskItem[];
  isRiskLoading: boolean;
  summary: { english: string; hindi: string };
  deletingDocumentId: string | null;
}) {
  const originalDocumentText = document.chunks?.map((chunk) => chunk.original).join('\n\n') || '';
  const summarizedHighlights = (document.chunks || []).slice(0, 5).map((chunk) => ({
    id: chunk.id,
    text: language === 'English' ? chunk.english : chunk.hindi,
    risk: chunk.risk
  }));
  // Build raw points from the summary string (or Hindi) and sanitize them
  let summaryPoints = (language === 'English' ? (summary?.english || '') : (summary?.hindi || ''))
    .split(/(?:\r?\n)+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      // If line already looks like a bullet list, drop the lead markers
      const cleanedLine = trimmed.replace(/^\s*[\u2022\*\-]+\s*/, '').trim();

      // Prefer sentence splits where possible
      const sentences = cleanedLine.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
      if (sentences.length > 1) return sentences;

      // Fallback to common separators
      const semi = cleanedLine.split(/;|\u2022|•| - |\s?\u2013\s?|:\s+/).map(s => s.trim()).filter(Boolean);
      if (semi.length > 1) return semi;

      // Otherwise return the cleaned line as-is
      return [cleanedLine];
    })
    .map((point) => point.replace(/^[\u2022\*\-\s]+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Merge fragments that were split without terminal punctuation
  const merged: string[] = [];
  for (const p of summaryPoints) {
    if (!merged.length) {
      merged.push(p);
      continue;
    }
    const last = merged[merged.length - 1];
    // If last ends with terminal punctuation keep separate
    if (/[.!?]$/.test(last)) {
      merged.push(p);
      continue;
    }
    // Otherwise join the fragment to the previous item to avoid broken words
    merged[merged.length - 1] = (last + ' ' + p).replace(/\s+/g, ' ').trim();
  }

  // Remove any leading bullet characters accidentally left and dedupe
  const finalPoints = Array.from(new Set(merged.map(pt => pt.replace(/^[\u2022\*\-\s]+/, '').trim())));
  summaryPoints = finalPoints;

  // Filter out points that look like header/footer metadata (codes, page numbers, pure digits)
  summaryPoints = summaryPoints.filter(p => !looksLikeMetadataLine(p));

  // Ensure at least 5 points. First try splitting by commas across points, then progressively split longest points.
  if (summaryPoints.length < 5) {
    const commaSplit = summaryPoints.flatMap(p => p.split(',').map(s => s.trim()).filter(Boolean));
    if (commaSplit.length >= 5) {
      summaryPoints = commaSplit;
    }
  }

  // Progressive splitting if still too few
  if (summaryPoints.length < 5) {
    // keep splitting the longest point until we have at least 5 or cannot split further
    while (summaryPoints.length < 5) {
      // find index of longest
      let maxIdx = 0;
      for (let i = 1; i < summaryPoints.length; i++) {
        if (summaryPoints[i].length > summaryPoints[maxIdx].length) maxIdx = i;
      }

      const longest = summaryPoints[maxIdx];
      if (longest.length < 40) break; // don't split tiny pieces

      // split by comma if possible
      const byComma = longest.split(',').map(s => s.trim()).filter(Boolean);
      if (byComma.length > 1) {
        summaryPoints.splice(maxIdx, 1, ...byComma);
        continue;
      }

      // else split in middle by word boundary
      const words = longest.split(/\s+/);
      if (words.length < 4) break;
      const mid = Math.floor(words.length / 2);
      const first = words.slice(0, mid).join(' ');
      const second = words.slice(mid).join(' ');
      summaryPoints.splice(maxIdx, 1, first, second);
    }
  }

  // Final trim and dedupe
  summaryPoints = summaryPoints.map(p => p.trim()).filter(Boolean);
  summaryPoints = Array.from(new Set(summaryPoints));

  // If still fewer than 5, evenly split the original summary text into up to 5 chunks
  if (summaryPoints.length < 5) {
    const original = (language === 'English' ? summary.english : summary.hindi).trim();

    // If the summary is the default placeholder or very short, don't fabricate multiple bullets.
    const isPlaceholder = original === 'Summary unavailable.' || original === 'सारांश उपलब्ध नहीं है।';
    if (isPlaceholder || original.length < 40) {
      summaryPoints = [original];
    } else {
      const words = original.split(/\s+/).filter(Boolean);
      if (words.length > 0) {
        const target = 5;
        const per = Math.ceil(words.length / target);
        const chunks: string[] = [];
        for (let i = 0; i < target; i++) {
          const slice = words.slice(i * per, (i + 1) * per);
          if (slice.length) chunks.push(slice.join(' '));
        }
        // replace only if this creates more points than we currently have
        if (chunks.length > summaryPoints.length) {
          summaryPoints = chunks.map(p => p.trim()).filter(Boolean);
        }
      }
    }
  }


  return (
    <div className="min-h-screen px-4 py-4 sm:px-5 lg:px-6 lg:py-5 flex flex-col">
      <header className="glass-panel sticky top-4 z-20 flex items-center justify-between rounded-[1.5rem] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <button className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/80" onClick={onBack}>
            ←
          </button>
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-white/40">Document</div>
            <div className="display-font text-xl font-semibold">{document.name}</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="button-strong px-5 py-3" onClick={onUpload}>
            ⤴ New Upload
          </button>
          <button className="button-soft px-5 py-3 text-rose-200" onClick={onDeleteDocument} disabled={deletingDocumentId === document.id}>
            {deletingDocumentId === document.id ? 'Deleting...' : 'Delete PDF'}
          </button>
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium">Workspace User</div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-white/35">legal-team@workspace.local</div>
          </div>
        </div>
      </header>

      <main className="mt-6 grid gap-5 xl:grid-cols-[1fr_1.5fr_1fr] flex-1 pb-2">
        <aside className="glass-panel rounded-[1.8rem] p-5 h-[calc(100vh-130px)] flex flex-col overflow-auto">
          <div className="text-xs uppercase tracking-[0.28em] text-white/35">Risk overview</div>
          <div className="mt-4 flex items-end gap-3">
            <div className="display-font text-6xl text-white">{document.riskScore}</div>
            <div className="pb-2 text-white/40">/ 100</div>
          </div>

          <div className="mt-6 h-2 rounded-full bg-white/8 overflow-hidden flex">
            {['Critical', 'Warning', 'Medium'].map((sev) => {
              const count = riskItems.filter(r => r.severity === sev).length;
              const totalRisks = riskItems.length || 1;
              const pct = (count / totalRisks) * 100;
              const color = sev === 'Critical' ? 'bg-rose-400' : sev === 'Warning' ? 'bg-amber-300' : 'bg-blue-400';
              return (
                <div 
                  key={sev} 
                  className={`h-full ${color} transition-all duration-500`} 
                  style={{ width: `${count > 0 ? pct : 0}%` }} 
                  title={`${sev}: ${count}`}
                />
              );
            })}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2">
            {['Critical', 'Warning', 'Medium'].map(sev => (
              <div key={sev} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
                <div className="text-[9px] uppercase tracking-widest text-white/40">{sev}</div>
                <div className={`mt-1 text-lg font-bold ${sev === 'Critical' ? 'text-rose-300' : sev === 'Warning' ? 'text-amber-200' : 'text-blue-200'}`}>
                  {riskItems.filter(r => r.severity === sev).length}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4 flex-1 overflow-auto">
            <div className="text-xs uppercase tracking-[0.28em] text-white/35">Red-flag clauses</div>
            <div className="mt-3 space-y-3">
              {riskItems.length > 0 ? (
                riskItems.map((item) => (
                  <RiskCard key={item.id} item={item} />
                ))
              ) : isRiskLoading ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/58">
                  Analyzing red-flag clauses...
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-center">
                  <div className="text-2xl mb-2">✅</div>
                  <div className="text-sm font-medium text-white/90">No red flags identified.</div>
                  <p className="mt-2 text-[11px] text-white/40 leading-relaxed">
                    If this document previously showed risks, please <button onClick={onUpload} className="text-blue-300 underline">re-upload</button> to see the new categorized insights.
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="glass-panel rounded-[1.8rem] p-5 h-[calc(100vh-130px)] flex flex-col">
          <div className="mb-4 flex items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-white/35">Original document</div>
              <div className="mt-1 text-sm text-white/55">Full extracted source text</div>
            </div>
            <div className="text-xs uppercase tracking-[0.28em] text-white/30">Continuous view</div>
          </div>
          <div className="flex-1 overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.025]">
            <iframe
              src={`${getDocumentPdfUrl(document.id)}#toolbar=0&navpanes=0`}
              className="h-full w-full border-none"
              title="Original Document PDF"
            />
          </div>
        </section>

        <section className="glass-panel rounded-[1.8rem] p-5 h-[calc(100vh-130px)] flex flex-col overflow-auto">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-white/35">Important summary</div>
              <div className="mt-1 text-sm text-white/55">Condensed key points only</div>
            </div>
            <select
              value={language}
              onChange={(event) => onLanguageChange(event.target.value as Language)}
              className="field max-w-[140px] px-3 py-2 text-sm"
            >
              <option>English</option>
              <option>Hindi</option>
            </select>
          </div>

          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-[1.5rem] border border-white/10 bg-white/[0.025] p-5 flex-1 overflow-auto"
          >
            <div className="display-font text-2xl font-semibold mb-4">Key points</div>
            <ul className="space-y-3 pl-5 text-base leading-relaxed text-white/75 list-disc">
              {summaryPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </motion.div>

          <div className="mt-5 rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.28em] text-white/35">Risk score</div>
            <div className="mt-3 flex items-end gap-3">
              <div className="display-font text-5xl text-white">{document.riskScore}</div>
              <div className="pb-1 text-white/55">/100</div>
            </div>
            <p className="mt-2 text-sm text-white/55">Summary language: {language}</p>
          </div>
        </section>
      </main>
      <button
        className="fixed bottom-6 right-6 rounded-full border border-white/15 bg-white text-black shadow-2xl shadow-black/40"
        onClick={onOpenChat}
      >
        <div className="flex items-center gap-3 px-4 py-3 text-sm font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-black text-white">L</span>
          <span>Open legal assistant</span>
        </div>
      </button>
    </div>
  );
}

function ChatBubble({
  open,
  onClose,
  query,
  setQuery,
  messages,
  isSending,
  onSend
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  setQuery: (value: string) => void;
  messages: Array<{ role: 'assistant' | 'user'; text: string }>;
  isSending: boolean;
  onSend: (question: string) => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          className="glass-panel fixed bottom-24 right-6 z-30 w-[min(92vw,360px)] rounded-[1.8rem] p-4"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <div className="display-font text-xl font-semibold">Ask Legalese AI</div>
              <div className="text-xs uppercase tracking-[0.28em] text-white/35">Grounded Q&A mode</div>
            </div>
            <button className="button-soft px-3 py-2 text-sm" onClick={onClose}>Close</button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="max-h-56 space-y-3 overflow-auto pr-1">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
                    message.role === 'user' ? 'ml-8 border-white/15 bg-white/6 text-white' : 'mr-8 border-white/10 bg-black/20 text-white/75'
                  }`}
                >
                  {message.text}
                </div>
              ))}
            </div>

            <div className="grid gap-2">
              {quickQuestions.map((item) => (
                <button key={item} className="button-soft w-full px-4 py-3 text-left text-sm" onClick={() => onSend(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <textarea
              className="field min-h-[110px] resize-none"
              placeholder="Ask only about this document..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="button-strong w-full px-4 py-3" onClick={() => onSend(query)} disabled={isSending}>
              {isSending ? 'Thinking...' : 'Send question'}
            </button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function RiskCard({ item }: { item: RiskItem }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const severityColor = item.severity === 'Critical' ? 'text-rose-300 border-rose-300/30 bg-rose-300/10' : 'text-amber-200 border-amber-200/30 bg-amber-200/10';
  
  return (
    <div className="group rounded-2xl border border-white/10 bg-white/[0.02] transition-all hover:bg-white/[0.04]">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${severityColor}`}>
                {item.severity}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-white/40">{item.category}</span>
            </div>
            <h4 className="mt-2 text-base font-semibold text-white/90">{item.summary}</h4>
          </div>
          <div className="text-xl">
            {item.category.includes('Financial') ? '💸' : item.category.includes('Legal') ? '⚖' : '🛑'}
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-emerald-400/5 p-3 border border-emerald-400/10">
          <div className="text-[10px] uppercase tracking-widest text-emerald-400/60 font-bold">Recommended Action</div>
          <p className="mt-1 text-xs text-emerald-200/80 leading-relaxed">{item.mitigation}</p>
        </div>

        <button 
          onClick={() => setShowOriginal(!showOriginal)}
          className="mt-4 text-[10px] uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
        >
          {showOriginal ? 'Hide' : 'View'} Original Clause
        </button>

        <AnimatePresence>
          {showOriginal && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-xl bg-black/30 p-3 text-[13px] leading-6 text-white/50 italic border border-white/5">
                "{item.clause_text}"
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SignupScreen({
  fullName,
  onFullNameChange,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  confirmPassword,
  onConfirmPasswordChange,
  status,
  onStatusChange,
  isSubmitting,
  onSubmit,
  onBackToLogin
}: {
  fullName: string;
  onFullNameChange: (value: string) => void;
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  confirmPassword: string;
  onConfirmPasswordChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  isSubmitting: boolean;
  onSubmit: () => Promise<void>;
  onBackToLogin: () => void;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative flex flex-col justify-between overflow-hidden px-8 py-8 sm:px-12 lg:px-14 lg:py-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_25%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_35%)]" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-white/15 bg-white/90 text-black">
            ⚖
          </div>
          <div>
            <div className="display-font text-2xl font-semibold">Legalese</div>
            <div className="text-xs uppercase tracking-[0.28em] text-white/45">AI legal simplifier</div>
          </div>
        </div>

        <div className="relative max-w-xl pb-10 pt-10 lg:pt-0">
          <div className="mb-4 text-xs uppercase tracking-[0.32em] text-white/40">Create your account</div>
          <h1 className="display-font max-w-lg text-5xl font-semibold leading-[0.95] text-white sm:text-6xl">
            Join thousands of legal professionals.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-white/70">
            Sign up today to access AI-powered document simplification and risk analysis.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {heroPoints.map(([label, value]) => (
              <div key={label} className="subtle-panel rounded-2xl p-4">
                <div className="text-sm font-semibold text-white">{label}</div>
                <div className="mt-1 text-sm text-white/55">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs uppercase tracking-[0.32em] text-white/35">
          Assistant output for review support, not legal counsel.
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="glass-panel w-full max-w-md rounded-[2rem] p-7 sm:p-9">
          <div className="mb-8">
            <div className="text-xs uppercase tracking-[0.3em] text-white/45">Account creation</div>
            <h2 className="display-font mt-3 text-4xl font-semibold text-white">Get started</h2>
            <p className="mt-3 text-white/60">Create an account to begin simplifying legal documents.</p>
          </div>

          <div className="space-y-4">
            <label className="block text-xs uppercase tracking-[0.28em] text-white/40">Full Name</label>
            <input
              className="field"
              placeholder="Your full name"
              type="text"
              value={fullName}
              onChange={(event) => onFullNameChange(event.target.value)}
            />

            <label className="block text-xs uppercase tracking-[0.28em] text-white/40">Email</label>
            <input
              className="field"
              placeholder="you@firm.com"
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
            />

            <label className="block text-xs uppercase tracking-[0.28em] text-white/40">Password</label>
            <input
              className="field"
              placeholder="At least 6 characters"
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
            />

            <label className="block text-xs uppercase tracking-[0.28em] text-white/40">Confirm Password</label>
            <input
              className="field"
              placeholder="Confirm your password"
              type="password"
              value={confirmPassword}
              onChange={(event) => onConfirmPasswordChange(event.target.value)}
            />

            <button className="button-strong w-full px-4 py-4" onClick={() => void onSubmit()} disabled={isSubmitting}>
              {isSubmitting ? 'Creating account...' : <span>Create account <span className="ml-2">→</span></span>}
            </button>

            <div className="pt-2 text-center text-sm text-white/55">
              Already have an account?{' '}
              <button className="underline decoration-white/30 underline-offset-4 hover:text-white" onClick={onBackToLogin}>
                Sign in
              </button>
            </div>

            {status ? <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/75">{status}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;

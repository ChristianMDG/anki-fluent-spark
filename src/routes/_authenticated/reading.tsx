import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  suggestBooksForLevel,
  fetchBookText,
  explainWordInContext,
  generateComprehensionCheck,
  type ComprehensionQuestion,
} from "@/lib/reading.functions";
import { generateVocabCard } from "@/lib/vocab.functions";
import {
  Search,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Sparkles,
  Plus,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/reading")({
  component: ReadingPage,
});

// ---------------------------------------------------------------------------
// Gutendex types
// ---------------------------------------------------------------------------

interface GutendexBook {
  id: number;
  title: string;
  authors: { name: string; birth_year: number | null; death_year: number | null }[];
  subjects: string[];
  languages: string[];
  download_count: number;
  formats: Record<string, string>;
}

interface GutendexResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: GutendexBook[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBookCover(book: GutendexBook): string | null {
  for (const key of Object.keys(book.formats)) {
    if (key.includes("image/jpeg") || key === "image/jpeg") {
      return book.formats[key];
    }
  }
  return null;
}

function getBookTextUrl(book: GutendexBook): string | null {
  // Prefer UTF-8 plain text
  for (const key of Object.keys(book.formats)) {
    if (key.includes("text/plain") && key.includes("utf-8")) {
      return book.formats[key];
    }
  }
  // Fallback to any plain text
  for (const key of Object.keys(book.formats)) {
    if (key.startsWith("text/plain")) {
      return book.formats[key];
    }
  }
  return null;
}

function getBookAuthors(book: GutendexBook): string {
  return book.authors.map((a) => a.name).join(", ") || "Unknown Author";
}

async function searchGutendex(query: string, page = 1): Promise<GutendexResponse> {
  const params = new URLSearchParams({
    languages: "en",
    page: String(page),
  });
  if (query.trim()) params.set("search", query.trim());

  const res = await fetch(`https://gutendex.com/books?${params.toString()}`);
  if (!res.ok) throw new Error(`Gutendex error: HTTP ${res.status}`);
  return res.json() as Promise<GutendexResponse>;
}

// ---------------------------------------------------------------------------
// Hook: learner profile (minimal — reads from Supabase directly)
// ---------------------------------------------------------------------------

function useCurrentLevel(): string {
  const { data } = useQuery({
    queryKey: ["learner-profile"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profile } = await (supabase as any)
        .from("learner_profile")
        .select("current_level")
        .eq("user_id", user.id)
        .maybeSingle();
      return profile as { current_level: string } | null;
    },
    staleTime: 30_000,
  });
  return (data as { current_level: string } | null)?.current_level ?? "B1";
}

// ---------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------

type ReadingView = "browse" | "reader";

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

function ReadingPage() {
  const [view, setView] = useState<ReadingView>("browse");
  const [selectedBook, setSelectedBook] = useState<GutendexBook | null>(null);

  function handleSelectBook(book: GutendexBook) {
    setSelectedBook(book);
    setView("reader");
  }

  function handleBackToBrowse() {
    setView("browse");
    setSelectedBook(null);
  }

  if (view === "reader" && selectedBook) {
    return <BookReader book={selectedBook} onBack={handleBackToBrowse} />;
  }

  return <BookBrowse onSelectBook={handleSelectBook} />;
}

// ===========================================================================
// BROWSE VIEW
// ===========================================================================

interface BookCardProps {
  book: GutendexBook;
  onClick: (book: GutendexBook) => void;
}

function BookCard({ book, onClick }: BookCardProps) {
  const cover = getBookCover(book);
  const authors = getBookAuthors(book);
  const hasText = !!getBookTextUrl(book);

  return (
    <button
      id={`book-card-${book.id}`}
      onClick={() => onClick(book)}
      disabled={!hasText}
      className={`group glass-panel-soft p-0 overflow-hidden text-left flex flex-col transition-all duration-300 rounded-2xl ${
        hasText
          ? "hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(237,28,36,0.2)] hover:border-[var(--color-crimson)]/50 cursor-pointer"
          : "opacity-50 cursor-not-allowed"
      }`}
      title={!hasText ? "No readable text available for this book" : book.title}
    >
      {/* Cover */}
      <div className="w-full aspect-[2/3] bg-black/40 overflow-hidden flex-shrink-0 relative">
        {cover ? (
          <img
            src={cover}
            alt={`Cover of ${book.title}`}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1a0808] to-[#2d0f0f]">
            <BookOpen size={36} className="text-[var(--color-crimson)]/40" />
          </div>
        )}
        {!hasText && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="label-mono text-[10px] text-neutral-400">No text available</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex-1 flex flex-col gap-1 min-h-0">
        <p className="text-sm font-semibold leading-tight line-clamp-2 text-white group-hover:text-[var(--color-gold)] transition-colors duration-200">
          {book.title}
        </p>
        <p className="text-xs text-neutral-400 line-clamp-1">{authors}</p>
        <p className="label-mono text-[9px] mt-auto text-neutral-500">
          {book.download_count.toLocaleString()} downloads
        </p>
      </div>
    </button>
  );
}

function BookBrowse({ onSelectBook }: { onSelectBook: (book: GutendexBook) => void }) {
  const level = useCurrentLevel();
  const suggestFn = useServerFn(suggestBooksForLevel);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  function handleSearchChange(v: string) {
    setSearchQuery(v);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(v);
    }, 500);
  }

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // AI suggestions → resolved through Gutendex
  const suggestionsQuery = useQuery({
    queryKey: ["book-suggestions", level],
    queryFn: async (): Promise<GutendexBook[]> => {
      const { suggestions } = await suggestFn({ data: { level } });
      if (!suggestions.length) return [];

      // Resolve each suggestion through Gutendex (parallel, max 8)
      const resolved = await Promise.allSettled(
        suggestions.slice(0, 8).map(async (s) => {
          const query = `${s.title} ${s.author}`;
          const res = await searchGutendex(query, 1);
          // Take first result that has a text URL
          const match = res.results.find((b) => getBookTextUrl(b));
          return match ?? null;
        }),
      );

      return resolved
        .filter(
          (r): r is PromiseFulfilledResult<GutendexBook> =>
            r.status === "fulfilled" && r.value !== null,
        )
        .map((r) => r.value);
    },
    staleTime: 5 * 60_000, // 5 minutes
  });

  // Search results (only when query present)
  const searchResultsQuery = useQuery({
    queryKey: ["gutendex-search", debouncedQuery],
    queryFn: async (): Promise<GutendexBook[]> => {
      if (!debouncedQuery.trim()) return [];
      const res = await searchGutendex(debouncedQuery);
      return res.results;
    },
    enabled: !!debouncedQuery.trim(),
    staleTime: 60_000,
  });

  const isSearching = !!debouncedQuery.trim();

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div>
        <p className="label-mono text-[var(--color-gold)]">Reading Room</p>
        <h1 className="text-3xl md:text-4xl font-bold mt-1">Public-Domain Library</h1>
        <p className="text-muted-foreground mt-2 max-w-xl">
          Browse and read classic English literature from Project Gutenberg, with AI-powered
          vocabulary support, comprehension checks, and instant card generation.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
        />
        <input
          id="reading-search-input"
          type="search"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by title, author, or keyword…"
          className="w-full bg-black/40 border border-[var(--color-border)]/60 rounded-2xl pl-12 pr-5 py-3.5 text-white placeholder-neutral-500 focus:outline-none focus:border-[var(--color-crimson)]/60 focus:ring-1 focus:ring-[var(--color-crimson)]/30 transition-all"
        />
        {searchQuery && (
          <button
            onClick={() => {
              setSearchQuery("");
              setDebouncedQuery("");
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white transition-colors"
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Search results */}
      {isSearching && (
        <section aria-label="Search results">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Search results</h2>
            {searchResultsQuery.isLoading && (
              <Loader2 size={16} className="animate-spin text-neutral-400" />
            )}
          </div>

          {searchResultsQuery.isError && (
            <div className="flex items-center gap-2 text-sm text-red-400 py-4">
              <AlertCircle size={16} />
              Could not reach Gutendex. Check your connection.
            </div>
          )}

          {searchResultsQuery.data && searchResultsQuery.data.length === 0 && !searchResultsQuery.isLoading && (
            <p className="text-muted-foreground text-sm py-4">
              No results found for "{debouncedQuery}".
            </p>
          )}

          {searchResultsQuery.data && searchResultsQuery.data.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {searchResultsQuery.data.map((book) => (
                <BookCard key={book.id} book={book} onClick={onSelectBook} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Suggestions (shown when not searching) */}
      {!isSearching && (
        <section aria-label="Suggested books for your level">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles size={16} className="text-[var(--color-gold)]" />
            <h2 className="text-lg font-semibold">
              Suggested for you{" "}
              <span className="label-mono text-[var(--color-gold)] ml-2">{level}</span>
            </h2>
            {suggestionsQuery.isLoading && (
              <Loader2 size={16} className="animate-spin text-neutral-400" />
            )}
          </div>

          {suggestionsQuery.isError && (
            <div className="flex items-center gap-2 text-sm text-red-400 py-4">
              <AlertCircle size={16} />
              Could not load suggestions.
            </div>
          )}

          {suggestionsQuery.data && suggestionsQuery.data.length === 0 && !suggestionsQuery.isLoading && (
            <p className="text-muted-foreground text-sm py-4">
              No suggestions available right now. Try searching for a title you know.
            </p>
          )}

          {suggestionsQuery.data && suggestionsQuery.data.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {suggestionsQuery.data.map((book) => (
                <BookCard key={book.id} book={book} onClick={onSelectBook} />
              ))}
            </div>
          )}

          {/* Skeleton placeholders while loading */}
          {suggestionsQuery.isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-panel-soft rounded-2xl overflow-hidden animate-pulse">
                  <div className="aspect-[2/3] bg-white/5" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-white/5 rounded w-4/5" />
                    <div className="h-2 bg-white/5 rounded w-3/5" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Attribution */}
      <p className="text-[10px] text-neutral-600 text-center pt-4 border-t border-white/5">
        All books provided by{" "}
        <a
          href="https://www.gutenberg.org"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-neutral-400 transition-colors"
        >
          Project Gutenberg
        </a>{" "}
        and searched via{" "}
        <a
          href="https://gutendex.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-neutral-400 transition-colors"
        >
          Gutendex
        </a>
        . All texts are in the public domain.
      </p>
    </div>
  );
}

// ===========================================================================
// READER VIEW
// ===========================================================================

interface WordExplain {
  definition: string;
  usage: string;
}

interface PopoverState {
  word: string;
  sentence: string;
  x: number;
  y: number;
  explain: WordExplain | null;
  loading: boolean;
  cardAdded: boolean;
}

function BookReader({ book, onBack }: { book: GutendexBook; onBack: () => void }) {
  const level = useCurrentLevel();
  const qc = useQueryClient();
  const fetchTextFn = useServerFn(fetchBookText);
  const explainFn = useServerFn(explainWordInContext);
  const comprehensionFn = useServerFn(generateComprehensionCheck);
  const generateCardFn = useServerFn(generateVocabCard);

  const [chunks, setChunks] = useState<string[]>([]);
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [loadingText, setLoadingText] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Word explain popover
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const explainCache = useRef<Map<string, WordExplain>>(new Map());

  // Comprehension check state
  const [showCheck, setShowCheck] = useState(false);
  const [checkQuestions, setCheckQuestions] = useState<ComprehensionQuestion[]>([]);
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkAnswered, setCheckAnswered] = useState(false);

  const readerRef = useRef<HTMLDivElement>(null);
  const authors = getBookAuthors(book);
  const textUrl = getBookTextUrl(book);

  // Load & save progress
  async function loadProgress() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("reading_progress")
      .select("current_chunk_index")
      .eq("user_id", user.id)
      .eq("gutenberg_book_id", book.id)
      .maybeSingle();
    return (data as { current_chunk_index: number } | null)?.current_chunk_index ?? 0;
  }

  async function saveProgress(chunkIndex: number, total: number) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("reading_progress").upsert(
      {
        user_id: user.id,
        gutenberg_book_id: book.id,
        book_title: book.title,
        current_chunk_index: chunkIndex,
        total_chunks: total,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,gutenberg_book_id" },
    );
  }

  // Fetch book text on mount
  useEffect(() => {
    if (!textUrl) {
      setLoadError("No readable text file found for this book.");
      setLoadingText(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoadingText(true);
      setLoadError(null);
      try {
        const result = await fetchTextFn({ data: { bookId: book.id, textUrl } });
        if (cancelled) return;

        const savedChunk = await loadProgress();
        setChunks(result.chunks);
        setTotalChunks(result.totalChunks);
        setCurrentChunk(Math.min(savedChunk, result.totalChunks - 1));
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      } finally {
        if (!cancelled) setLoadingText(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, textUrl]);

  // Scroll to top whenever chunk changes
  useEffect(() => {
    readerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentChunk]);

  function goToChunk(index: number) {
    const clamped = Math.max(0, Math.min(index, totalChunks - 1));
    setCurrentChunk(clamped);
    void saveProgress(clamped, totalChunks);
    setShowCheck(false);
    setCheckAnswered(false);
    setCheckQuestions([]);
    setPopover(null);
  }

  function handleNextChunk() {
    if (currentChunk < totalChunks - 1) {
      // Offer comprehension check before advancing
      if (!showCheck && !checkAnswered) {
        void triggerComprehensionCheck();
        return;
      }
      goToChunk(currentChunk + 1);
    }
  }

  function handlePrevChunk() {
    goToChunk(currentChunk - 1);
  }

  async function triggerComprehensionCheck() {
    if (checkLoading) return;
    setShowCheck(true);
    setCheckLoading(true);
    setCheckQuestions([]);
    try {
      const chunk = chunks[currentChunk] ?? "";
      const result = await comprehensionFn({
        data: { chunkText: chunk.slice(0, 3000), level },
      });
      setCheckQuestions(result.questions);
    } catch {
      // If AI fails, silently skip the check
      setShowCheck(false);
    } finally {
      setCheckLoading(false);
    }
  }

  // Word click handler
  function handleWordClick(e: React.MouseEvent<HTMLSpanElement>, word: string) {
    if (!word.trim() || word.length < 2) return;
    const cleanWord = word.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
    if (!cleanWord) return;

    // Get the sentence containing this word from current chunk
    const chunk = chunks[currentChunk] ?? "";
    const sentences = chunk.split(/[.!?]+/);
    const sentence = sentences.find((s) => s.toLowerCase().includes(cleanWord)) ?? chunk.slice(0, 200);

    const rect = (e.target as HTMLElement).getBoundingClientRect();

    // If cached, show immediately
    const cached = explainCache.current.get(cleanWord);
    if (cached) {
      setPopover({ word: cleanWord, sentence, x: rect.left, y: rect.bottom + window.scrollY + 8, explain: cached, loading: false, cardAdded: false });
      return;
    }

    setPopover({ word: cleanWord, sentence, x: rect.left, y: rect.bottom + window.scrollY + 8, explain: null, loading: true, cardAdded: false });

    // Fetch explanation
    explainFn({ data: { word: cleanWord, sentence: sentence.trim().slice(0, 500), level } })
      .then((result) => {
        explainCache.current.set(cleanWord, result);
        setPopover((prev) =>
          prev?.word === cleanWord ? { ...prev, explain: result, loading: false } : prev,
        );
      })
      .catch(() => {
        setPopover((prev) =>
          prev?.word === cleanWord
            ? { ...prev, explain: { definition: "Could not load definition.", usage: "" }, loading: false }
            : prev,
        );
      });
  }

  // Add word to vocabulary (full card generation via existing fn)
  const addCardMutation = useMutation({
    mutationFn: async (word: string) => {
      return generateCardFn({ data: { word, level } });
    },
    onSuccess: () => {
      toast.success("Card added to Library!", { description: "Full vocabulary card generated." });
      setPopover((prev) => (prev ? { ...prev, cardAdded: true } : prev));
      qc.invalidateQueries({ queryKey: ["cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Render chunk text as clickable words
  function renderClickableText(text: string) {
    return text.split(/(\s+)/).map((token, i) => {
      const isWord = /[a-zA-Z]/.test(token);
      if (!isWord) return <span key={i}>{token}</span>;
      return (
        <span
          key={i}
          onClick={(e) => handleWordClick(e, token)}
          className="cursor-pointer hover:text-[var(--color-gold)] hover:bg-[var(--color-crimson)]/10 rounded transition-colors duration-100 select-text"
          role="button"
          tabIndex={-1}
          aria-label={`Define ${token}`}
        >
          {token}
        </span>
      );
    });
  }

  // Loading state
  if (loadingText) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col items-center justify-center gap-4 py-24">
        <Loader2 size={32} className="animate-spin text-[var(--color-crimson)]" />
        <p className="text-muted-foreground text-sm">Loading book text from Project Gutenberg…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center space-y-4">
        <AlertCircle size={32} className="text-red-400 mx-auto" />
        <p className="text-red-300 font-medium">Failed to load book</p>
        <p className="text-muted-foreground text-sm">{loadError}</p>
        <button onClick={onBack} className="btn-crimson rounded-xl px-5 py-2.5 text-sm mt-2">
          Back to Library
        </button>
      </div>
    );
  }

  const currentText = chunks[currentChunk] ?? "";

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in duration-500">
      {/* Back button + book info */}
      <div className="flex items-start gap-4 mb-6">
        <button
          id="reading-back-btn"
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors mt-1 shrink-0"
        >
          <ChevronLeft size={16} />
          Library
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">{book.title}</h1>
          <p className="text-sm text-neutral-400">{authors}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 space-y-1">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span className="label-mono">Progress</span>
          <span id="reading-progress-label" className="label-mono text-[var(--color-gold)]">
            Page {currentChunk + 1} of {totalChunks}
          </span>
        </div>
        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[var(--color-crimson)] to-[var(--color-gold)] transition-all duration-500"
            style={{ width: `${((currentChunk + 1) / totalChunks) * 100}%` }}
          />
        </div>
      </div>

      {/* Comprehension check (shown before advancing to next chunk) */}
      {showCheck && (
        <div className="mb-6 glass-panel p-6 border-[var(--color-gold)]/30 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--color-gold)]" />
              <h3 className="font-semibold text-sm">Quick Comprehension Check</h3>
            </div>
            <button
              id="skip-comprehension-btn"
              onClick={() => {
                setShowCheck(false);
                setCheckAnswered(true);
                goToChunk(currentChunk + 1);
              }}
              className="text-xs text-neutral-500 hover:text-white transition-colors"
            >
              Skip →
            </button>
          </div>

          {checkLoading && (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 size={14} className="animate-spin" />
              Generating questions…
            </div>
          )}

          {!checkLoading && checkQuestions.length === 0 && (
            <p className="text-sm text-muted-foreground">No questions generated. Skip to continue.</p>
          )}

          {!checkLoading && checkQuestions.length > 0 && (
            <div className="space-y-5">
              {checkQuestions.map((q, i) => (
                <ComprehensionQuizItem
                  key={i}
                  question={q}
                />
              ))}
              <button
                id="comprehension-continue-btn"
                onClick={() => {
                  setShowCheck(false);
                  setCheckAnswered(true);
                  goToChunk(currentChunk + 1);
                }}
                className="btn-crimson rounded-xl px-4 py-2 text-sm w-full mt-2"
              >
                Continue to next page →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Reader area */}
      {!showCheck && (
        <div
          ref={readerRef}
          className="glass-panel p-6 md:p-10 mb-6"
          style={{
            background: "rgba(14, 6, 4, 0.75)",
            backdropFilter: "blur(20px)",
          }}
        >
          {/* Reader text */}
          <div
            id="reader-text-content"
            className="prose-reader"
            style={{
              fontSize: "1.05rem",
              lineHeight: "1.9",
              fontFamily: "'Georgia', 'Times New Roman', serif",
              color: "oklch(0.88 0.02 30)",
              maxWidth: "72ch",
              margin: "0 auto",
              userSelect: "text",
            }}
          >
            {currentText.split(/\n\n+/).map((para, i) => (
              <p key={i} style={{ marginBottom: "1.4em" }}>
                {renderClickableText(para.trim())}
              </p>
            ))}
          </div>

          {/* Attribution */}
          <p
            className="text-center mt-10 pt-6 border-t border-white/5"
            style={{ fontSize: "0.7rem", color: "oklch(0.5 0.02 30)" }}
          >
            Text provided by{" "}
            <a
              href={`https://www.gutenberg.org/ebooks/${book.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-80"
            >
              Project Gutenberg
            </a>{" "}
            (gutenberg.org). This work is in the public domain.
          </p>
        </div>
      )}

      {/* Navigation */}
      {!showCheck && (
        <div className="flex items-center justify-between gap-4">
          <button
            id="reading-prev-btn"
            onClick={handlePrevChunk}
            disabled={currentChunk === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--color-border)]/60 text-sm text-neutral-300 hover:text-white hover:bg-white/5 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
            Previous
          </button>

          <span className="label-mono text-[10px] text-neutral-500">
            {currentChunk + 1} / {totalChunks}
          </span>

          <button
            id="reading-next-btn"
            onClick={handleNextChunk}
            disabled={currentChunk >= totalChunks - 1}
            className="btn-crimson flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Word explain popover */}
      {popover && (
        <WordPopover
          popover={popover}
          onClose={() => setPopover(null)}
          onAddCard={() => {
            if (!popover.cardAdded && !addCardMutation.isPending) {
              addCardMutation.mutate(popover.word);
            }
          }}
          isPendingCard={addCardMutation.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comprehension quiz item (reuses same visual pattern as FullLessonModal)
// ---------------------------------------------------------------------------

function ComprehensionQuizItem({ question }: { question: ComprehensionQuestion }) {
  const [picked, setPicked] = useState<number | null>(null);

  return (
    <div>
      <p className="font-medium text-sm mb-2">{question.question}</p>
      <div className="space-y-1.5">
        {question.options.map((opt, i) => {
          const isCorrect = i === question.correctIndex;
          const revealed = picked !== null;
          return (
            <button
              key={i}
              id={`comprehension-option-${i}`}
              disabled={revealed}
              onClick={() => setPicked(i)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition ${
                revealed
                  ? isCorrect
                    ? "border-emerald-500 bg-emerald-950/30 text-emerald-200"
                    : picked === i
                      ? "border-red-500 bg-red-950/30 text-red-200"
                      : "border-[var(--color-border)] opacity-60"
                  : "border-[var(--color-border)] hover:border-[var(--color-crimson-glow)]"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <p className="text-xs text-muted-foreground mt-2">{question.explanation}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Word explain popover
// ---------------------------------------------------------------------------

function WordPopover({
  popover,
  onClose,
  onAddCard,
  isPendingCard,
}: {
  popover: PopoverState;
  onClose: () => void;
  onAddCard: () => void;
  isPendingCard: boolean;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      id="word-explain-popover"
      role="dialog"
      aria-label={`Definition of ${popover.word}`}
      className="fixed z-[200] w-72 glass-panel p-4 space-y-3 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
      style={{
        left: Math.min(popover.x, window.innerWidth - 300),
        top: popover.y,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="font-bold text-base capitalize text-[var(--color-gold)]">{popover.word}</p>
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-white transition-colors"
          aria-label="Close definition"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      {popover.loading && (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 size={13} className="animate-spin" />
          Looking it up…
        </div>
      )}

      {popover.explain && !popover.loading && (
        <div className="space-y-2">
          <p className="text-sm leading-relaxed">{popover.explain.definition}</p>
          {popover.explain.usage && (
            <p className="text-xs text-neutral-400 italic">{popover.explain.usage}</p>
          )}
        </div>
      )}

      {/* Add to vocabulary */}
      {!popover.loading && (
        <button
          id="add-vocab-from-reader-btn"
          onClick={onAddCard}
          disabled={isPendingCard || popover.cardAdded}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition ${
            popover.cardAdded
              ? "bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 cursor-default"
              : "btn-crimson hover:shadow-[0_4px_20px_rgba(237,28,36,0.35)]"
          } disabled:opacity-60`}
        >
          {isPendingCard ? (
            <Loader2 size={12} className="animate-spin" />
          ) : popover.cardAdded ? (
            <CheckCircle2 size={12} />
          ) : (
            <Plus size={12} />
          )}
          {popover.cardAdded ? "Added to Library" : isPendingCard ? "Generating card…" : "Add to vocabulary"}
        </button>
      )}
    </div>
  );
}

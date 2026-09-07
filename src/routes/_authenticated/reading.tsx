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
  searchGutendex,
  type ComprehensionQuestion,
  type GutendexBook,
  type GutendexResponse,
} from "@/lib/reading.functions";
import { generateVocabCard } from "@/lib/vocab.functions";
import {
  Search,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  Loader2,
  Sparkles,
  Plus,
  CheckCircle2,
  AlertCircle,
  Maximize2,
  Minimize2,
  Type,
  Palette,
  Columns,
  Square,
  Bookmark,
} from "lucide-react";
import { toast } from "sonner";


// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/reading")({
  component: ReadingPage,
});

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

function getBookTextUrl(book: GutendexBook): string {
  // Always return canonical Gutenberg HTTPS text cache URL for this book ID
  return `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.txt`;
}


function getBookAuthors(book: GutendexBook): string {
  return book.authors.map((a) => a.name).join(", ") || "Unknown Author";
}

// ---------------------------------------------------------------------------
// Hook: learner profile (minimal — reads from Supabase directly)
// ---------------------------------------------------------------------------

function useCurrentLevel(): string {
  const { data } = useQuery({
    queryKey: ["learner-profile"],
    queryFn: async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: profile, error } = await (supabase as any)
          .from("learner_profile")
          .select("current_level")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) return null;
        return profile as { current_level: string } | null;
      } catch {
        return null;
      }
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
  const searchGutendexFn = useServerFn(searchGutendex);

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

  // AI suggestions → resolved through Gutendex server function
  const suggestionsQuery = useQuery({
    queryKey: ["book-suggestions", level],
    queryFn: async (): Promise<GutendexBook[]> => {
      const { suggestions } = await suggestFn({ data: { level } });
      if (!suggestions.length) return [];

      // Resolve each suggestion through Gutendex (parallel, max 8)
      const resolved = await Promise.allSettled(
        suggestions.slice(0, 8).map(async (s) => {
          const query = `${s.title} ${s.author}`;
          const res = await searchGutendexFn({ data: { query, page: 1 } });
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
      const res = await searchGutendexFn({ data: { query: debouncedQuery.trim(), page: 1 } });
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

// ---------------------------------------------------------------------------
// Paper themes & typography options
// ---------------------------------------------------------------------------

type PaperThemeKey = "sepia" | "linen" | "dark" | "amber";
type FontKey = "merriweather" | "playfair" | "lora" | "cinzel";

interface PaperThemeConfig {
  id: PaperThemeKey;
  name: string;
  icon: string;
  bg: string;
  text: string;
  subtext: string;
  border: string;
  stack: string;
  spine: string;
  accent: string;
  cover: string;
}

const PAPER_THEMES: Record<PaperThemeKey, PaperThemeConfig> = {
  sepia: {
    id: "sepia",
    name: "Classic Sepia",
    icon: "📜",
    bg: "#faf4e8",
    text: "#2b2219",
    subtext: "#7d7061",
    border: "#e8dac5",
    stack: "#decbb2",
    spine: "rgba(0,0,0,0.12)",
    accent: "#b8860b",
    cover: "#2c1a12",
  },
  linen: {
    id: "linen",
    name: "Cream Linen",
    icon: "📄",
    bg: "#f8f6f0",
    text: "#1c1c1c",
    subtext: "#6e6e6e",
    border: "#e2ddd4",
    stack: "#d8d1c5",
    spine: "rgba(0,0,0,0.10)",
    accent: "#8b0000",
    cover: "#1b2120",
  },
  dark: {
    id: "dark",
    name: "Velvet Night",
    icon: "🌙",
    bg: "#16151a",
    text: "#e6e2da",
    subtext: "#868094",
    border: "#2e2938",
    stack: "#24202e",
    spine: "rgba(0,0,0,0.40)",
    accent: "#ffd479",
    cover: "#0d0c10",
  },
  amber: {
    id: "amber",
    name: "Warm Amber",
    icon: "🏺",
    bg: "#f3e9db",
    text: "#2c2017",
    subtext: "#7a6758",
    border: "#dfceb6",
    stack: "#d4c0a5",
    spine: "rgba(0,0,0,0.15)",
    accent: "#9b3b19",
    cover: "#351e14",
  },
};

const FONT_OPTIONS: { id: FontKey; name: string; cssClass: string }[] = [
  { id: "merriweather", name: "Merriweather", cssClass: "font-merriweather" },
  { id: "playfair", name: "Playfair", cssClass: "font-playfair" },
  { id: "lora", name: "Lora", cssClass: "font-lora" },
          { id: "cinzel", name: "Cinzel", cssClass: "font-cinzel" },
];

// ---------------------------------------------------------------------------
// Text pagination helper — splits full text into ~300 word book pages
// ---------------------------------------------------------------------------

function paginateTextIntoPages(fullText: string): string[] {
  let text = fullText;

  // Strip Gutenberg legal preamble/postamble header lines if present to start directly at Chapter 1
  const startMatch = text.match(/\*\*\*\s*START OF TH(IS|E) PROJECT GUTENBERG EBOOK[^\*]*\*\*\*/i);
  if (startMatch && startMatch.index !== undefined) {
    text = text.slice(startMatch.index + startMatch[0].length);
  }
  const endMatch = text.match(/\*\*\*\s*END OF TH(IS|E) PROJECT GUTENBERG EBOOK/i);
  if (endMatch && endMatch.index !== undefined) {
    text = text.slice(0, endMatch.index);
  }

  const rawParagraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\r/g, "").replace(/\n/g, " ").trim())
    .filter((p) => p.length > 0);

  const pages: string[] = [];
  let currentParas: string[] = [];
  let currentWords = 0;
  const TARGET_WORDS_PER_PAGE = 260; // Clean physical book size (~260 words per page)

  for (const para of rawParagraphs) {
    const paraWords = para.split(/\s+/).length;

    // If single paragraph is longer than target page length, break into sentence blocks
    if (paraWords > TARGET_WORDS_PER_PAGE) {
      const sentences = para.match(/[^.!?]+[.!?]+(\s+|$)/g) || [para];
      for (const sentence of sentences) {
        const sentenceWords = sentence.split(/\s+/).length;
        if (currentWords + sentenceWords > TARGET_WORDS_PER_PAGE && currentWords >= 120) {
          pages.push(currentParas.join("\n\n"));
          currentParas = [sentence.trim()];
          currentWords = sentenceWords;
        } else {
          currentParas.push(sentence.trim());
          currentWords += sentenceWords;
        }
      }
    } else {
      if (currentWords + paraWords > TARGET_WORDS_PER_PAGE && currentWords >= 120) {
        pages.push(currentParas.join("\n\n"));
        currentParas = [para];
        currentWords = paraWords;
      } else {
        currentParas.push(para);
        currentWords += paraWords;
      }
    }
  }

  if (currentParas.length > 0) {
    pages.push(currentParas.join("\n\n"));
  }

  return pages.filter((p) => p.trim().length > 0);
}

function BookReader({ book, onBack }: { book: GutendexBook; onBack: () => void }) {
  const level = useCurrentLevel();
  const qc = useQueryClient();
  const fetchTextFn = useServerFn(fetchBookText);
  const explainFn = useServerFn(explainWordInContext);
  const comprehensionFn = useServerFn(generateComprehensionCheck);
  const generateCardFn = useServerFn(generateVocabCard);

  const [pages, setPages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [loadingText, setLoadingText] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reader customization state
  const [themeKey, setThemeKey] = useState<PaperThemeKey>("sepia");
  const [fontKey, setFontKey] = useState<FontKey>("merriweather");
  const [fontSize, setFontSize] = useState<number>(17);
  const [twoPageMode, setTwoPageMode] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isFlipping, setIsFlipping] = useState<"next" | "prev" | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(false);

  // Responsive window resize listener
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const effectiveTwoPageMode = twoPageMode && !isMobile;

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

  const totalPages = pages.length;

  // Load & save progress
  async function loadProgress() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("reading_progress")
        .select("current_chunk_index")
        .eq("user_id", user.id)
        .eq("gutenberg_book_id", book.id)
        .maybeSingle();
      if (error) return 0;
      return (data as { current_chunk_index: number } | null)?.current_chunk_index ?? 0;
    } catch {
      return 0;
    }
  }

  async function saveProgress(idx: number, total: number) {
    try {
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
          current_chunk_index: idx,
          total_chunks: total,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,gutenberg_book_id" },
      );
    } catch {
      // Ignore error if table does not exist yet
    }
  }

  // Fetch book text on mount & paginate
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

        const fullText = result.chunks.join("\n\n");
        const bookPages = paginateTextIntoPages(fullText);
        setPages(bookPages);

        const savedIdx = await loadProgress();
        setPageIndex(Math.min(savedIdx, Math.max(0, bookPages.length - 1)));
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

  // Scroll to top whenever page changes
  useEffect(() => {
    readerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [pageIndex]);

  function goToPage(index: number) {
    const clamped = Math.max(0, Math.min(index, Math.max(0, totalPages - 1)));
    setPageIndex(clamped);
    void saveProgress(clamped, totalPages);
    setShowCheck(false);
    setCheckAnswered(false);
    setCheckQuestions([]);
    setPopover(null);
  }

  // Calculations for two-page spread vs single page
  const leftPageIndex = effectiveTwoPageMode ? Math.floor(pageIndex / 2) * 2 : pageIndex;
  const rightPageIndex = leftPageIndex + 1;
  const hasNextPage = effectiveTwoPageMode
    ? rightPageIndex < totalPages - 1 || leftPageIndex < totalPages - 1
    : pageIndex < totalPages - 1;
  const hasPrevPage = effectiveTwoPageMode ? leftPageIndex > 0 : pageIndex > 0;

  function handleNextPage() {
    if (hasNextPage) {
      if (!showCheck && !checkAnswered && (pageIndex + 1) % 10 === 0) {
        void triggerComprehensionCheck();
        return;
      }
      const step = effectiveTwoPageMode ? 2 : 1;
      goToPage(pageIndex + step);
    }
  }

  function handlePrevPage() {
    if (hasPrevPage) {
      const step = effectiveTwoPageMode ? 2 : 1;
      goToPage(Math.max(0, pageIndex - step));
    }
  }

  function triggerPageTurn(dir: "next" | "prev") {
    if (isFlipping) return;
    if (dir === "next" && hasNextPage) {
      setIsFlipping("next");
      setTimeout(() => {
        handleNextPage();
        setIsFlipping(null);
      }, 400);
    } else if (dir === "prev" && hasPrevPage) {
      setIsFlipping("prev");
      setTimeout(() => {
        handlePrevPage();
        setIsFlipping(null);
      }, 400);
    }
  }

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (showCheck || popover) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        triggerPageTurn("next");
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        triggerPageTurn("prev");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, totalPages, showCheck, popover, isFlipping, twoPageMode]);

  async function triggerComprehensionCheck() {
    if (checkLoading) return;
    setShowCheck(true);
    setCheckLoading(true);
    setCheckQuestions([]);
    try {
      const currentPageText = pages[pageIndex] ?? "";
      const result = await comprehensionFn({
        data: { chunkText: currentPageText.slice(0, 3000), level },
      });
      setCheckQuestions(result.questions);
    } catch {
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

    const pageText = pages[pageIndex] ?? "";
    const sentences = pageText.split(/[.!?]+/);
    const sentence = sentences.find((s) => s.toLowerCase().includes(cleanWord)) ?? pageText.slice(0, 200);

    const rect = (e.target as HTMLElement).getBoundingClientRect();

    const cached = explainCache.current.get(cleanWord);
    if (cached) {
      setPopover({ word: cleanWord, sentence, x: rect.left, y: rect.bottom + window.scrollY + 8, explain: cached, loading: false, cardAdded: false });
      return;
    }

    setPopover({ word: cleanWord, sentence, x: rect.left, y: rect.bottom + window.scrollY + 8, explain: null, loading: true, cardAdded: false });

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

  function renderClickableText(text: string) {
    return text.split(/(\s+)/).map((token, i) => {
      const isWord = /[a-zA-Z]/.test(token);
      if (!isWord) return <span key={i}>{token}</span>;
      return (
        <span
          key={i}
          onClick={(e) => handleWordClick(e, token)}
          className="cursor-pointer hover:underline hover:bg-amber-500/20 rounded transition-colors duration-100 select-text px-0.5"
          role="button"
          tabIndex={-1}
          aria-label={`Define ${token}`}
        >
          {token}
        </span>
      );
    });
  }

  if (loadingText) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col items-center justify-center gap-4 py-24">
        <Loader2 size={32} className="animate-spin text-[var(--color-crimson)]" />
        <p className="text-muted-foreground text-sm">Opening classic book from Project Gutenberg…</p>
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

  const currentTheme = PAPER_THEMES[themeKey];
  const currentFont = FONT_OPTIONS.find((f) => f.id === fontKey) ?? FONT_OPTIONS[0];

  // Content for left & right pages
  const leftText = pages[leftPageIndex] ?? "";
  const rightText = twoPageMode && rightPageIndex < totalPages ? (pages[rightPageIndex] ?? "") : "";

  const leftParagraphs = leftText.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const rightParagraphs = rightText.split(/\n\n+/).filter((p) => p.trim().length > 0);

  const displayProgressPage = effectiveTwoPageMode ? leftPageIndex + 1 : pageIndex + 1;

  return (
    <div
      className={`flipbook-stage w-full transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-[150] bg-black/90 p-4 sm:p-8 overflow-y-auto flex flex-col justify-center"
          : "max-w-6xl mx-auto space-y-6"
      }`}
    >
      {/* Top Header Control Toolbar */}
      <div className="flex items-center justify-between gap-3 bg-black/60 backdrop-blur-md p-3 rounded-2xl border border-white/10 text-xs flex-wrap">
        {/* Back button */}
        <button
          id="reading-back-btn"
          onClick={onBack}
          className="flex items-center gap-1.5 text-neutral-300 hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/10"
        >
          <ChevronLeft size={16} /> <span className="hidden sm:inline">Library</span>
        </button>

        {/* Title */}
        <div className="hidden lg:block text-center truncate max-w-xs">
          <p className="font-semibold text-white truncate">{book.title}</p>
          <p className="text-[10px] text-neutral-400 truncate">{authors}</p>
        </div>

        {/* Theme Selector */}
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl">
          {(Object.keys(PAPER_THEMES) as PaperThemeKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setThemeKey(key)}
              className={`px-2.5 py-1 rounded-lg transition-all text-xs flex items-center gap-1 ${
                themeKey === key
                  ? "bg-white/20 text-white font-medium shadow"
                  : "text-neutral-400 hover:text-white"
              }`}
              title={PAPER_THEMES[key].name}
            >
              <span>{PAPER_THEMES[key].icon}</span>
              <span className="hidden md:inline">{PAPER_THEMES[key].name.split(" ")[1]}</span>
            </button>
          ))}
        </div>

        {/* Font & Size Controls */}
        <div className="flex items-center gap-2">
          <select
            value={fontKey}
            onChange={(e) => setFontKey(e.target.value as FontKey)}
            className="bg-white/10 border border-white/10 text-white rounded-lg px-2.5 py-1 text-xs outline-none cursor-pointer"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.id} value={f.id} className="bg-neutral-900 text-white">
                {f.name}
              </option>
            ))}
          </select>

          {/* Font Size Adjuster */}
          <div className="flex items-center gap-1 bg-white/5 px-2 py-1 rounded-lg border border-white/5">
            <button
              onClick={() => setFontSize((s) => Math.max(14, s - 1))}
              className="text-neutral-400 hover:text-white px-1 font-bold text-xs"
              title="Decrease font size"
            >
              -
            </button>
            <span className="text-[11px] text-neutral-300 w-4 text-center">{fontSize}</span>
            <button
              onClick={() => setFontSize((s) => Math.min(24, s + 1))}
              className="text-neutral-400 hover:text-white px-1 font-bold text-xs"
              title="Increase font size"
            >
              +
            </button>
          </div>

          {/* Two-page vs Single-page Mode */}
          <button
            onClick={() => setTwoPageMode(!twoPageMode)}
            className={`p-1.5 rounded-lg transition hidden md:flex ${
              twoPageMode ? "bg-white/20 text-white" : "text-neutral-400 hover:text-white"
            }`}
            title={twoPageMode ? "Switch to single page view" : "Switch to 2-page open book spread"}
          >
            {twoPageMode ? <Columns size={16} /> : <Square size={16} />}
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white transition hover:bg-white/10"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span className="label-mono text-[10px]">BOOK PROGRESS</span>
          <span id="reading-progress-label" className="label-mono text-[var(--color-gold)] text-[11px]">
            Page {displayProgressPage} of {totalPages} ({Math.round((displayProgressPage / totalPages) * 100)}%)
          </span>
        </div>
        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[var(--color-crimson)] via-[var(--color-gold)] to-emerald-400 transition-all duration-500"
            style={{ width: `${(displayProgressPage / totalPages) * 100}%` }}
          />
        </div>
      </div>

      {/* Comprehension check modal */}
      {showCheck && (
        <div className="glass-panel p-6 border-[var(--color-gold)]/40 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl mx-auto">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--color-gold)]" />
              <h3 className="font-semibold text-sm">Quick Comprehension Check</h3>
            </div>
            <button
              id="skip-comprehension-btn"
              onClick={() => {
                setShowCheck(false);
                setCheckAnswered(true);
                goToPage(pageIndex + 1);
              }}
              className="text-xs text-neutral-400 hover:text-white transition-colors"
            >
              Skip →
            </button>
          </div>

          {checkLoading && (
            <div className="flex items-center gap-2 text-sm text-neutral-400 py-4">
              <Loader2 size={16} className="animate-spin" />
              Generating comprehension questions for page {displayProgressPage}…
            </div>
          )}

          {!checkLoading && checkQuestions.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No questions generated. Skip to continue.</p>
          )}

          {!checkLoading && checkQuestions.length > 0 && (
            <div className="space-y-5">
              {checkQuestions.map((q, i) => (
                <ComprehensionQuizItem key={i} question={q} />
              ))}
              <button
                id="comprehension-continue-btn"
                onClick={() => {
                  setShowCheck(false);
                  setCheckAnswered(true);
                  goToPage(pageIndex + 1);
                }}
                className="btn-crimson rounded-xl px-4 py-2.5 text-sm w-full mt-2 font-medium"
              >
                Continue to next page →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Physical 3D Flipbook Cover Frame */}
      {!showCheck && (
        <div
          className="flipbook-cover-frame rounded-2xl p-3 sm:p-5 md:p-7 transition-all duration-500 relative shadow-2xl"
          style={{
            background: currentTheme.cover,
            borderColor: "rgba(255, 255, 255, 0.12)",
          }}
        >
          {/* Silk Bookmark Ribbon */}
          <div
            className="absolute top-0 right-14 w-4 h-24 z-30 shadow-lg rounded-b flex items-end justify-center pb-1"
            style={{
              background: `linear-gradient(to bottom, ${currentTheme.accent}, #650000)`,
            }}
          >
            <Bookmark size={10} className="text-white/80" />
          </div>

          {/* Open Book Spread Container */}
          <div
            ref={readerRef}
            className={`relative rounded-xl overflow-hidden shadow-2xl transition-all duration-300 ${
              effectiveTwoPageMode ? "grid grid-cols-2" : "block max-w-2xl mx-auto"
            }`}
            style={{
              backgroundColor: currentTheme.bg,
              color: currentTheme.text,
              border: `1px solid ${currentTheme.border}`,
            }}
          >
            {/* SINGLE PAGE OR LEFT PAGE OF SPREAD */}
            <div
              className={`p-6 sm:p-8 md:p-10 flex flex-col justify-between min-h-[580px] relative ${
                effectiveTwoPageMode
                  ? "flipbook-page-stack-left"
                  : "flipbook-page-stack-single"
              } ${
                effectiveTwoPageMode
                  ? isFlipping === "prev"
                    ? "animate-page-flip-prev"
                    : ""
                  : isFlipping === "next"
                    ? "animate-single-page-next"
                    : isFlipping === "prev"
                      ? "animate-single-page-prev"
                      : ""
              }`}
              style={{
                boxShadow: effectiveTwoPageMode
                  ? `inset -18px 0 32px ${currentTheme.spine}`
                  : `inset 0 0 25px ${currentTheme.spine}`,
              }}
            >
              {/* Running Header */}
              <div
                className="flex items-center justify-between border-b pb-2 mb-6 text-[11px]"
                style={{ borderColor: currentTheme.border, color: currentTheme.subtext }}
              >
                <span className={`uppercase tracking-widest ${currentFont.cssClass} font-semibold truncate max-w-[220px]`}>
                  {book.title}
                </span>
                <span className="font-mono text-[9px] opacity-40 uppercase">
                  {effectiveTwoPageMode ? "Page " + (leftPageIndex + 1) : authors}
                </span>
              </div>

              {/* Page Body */}
              <div
                id="reader-text-content"
                className={`prose-reader ${currentFont.cssClass} flex-1`}
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight: "1.85",
                  userSelect: "text",
                }}
              >
                {leftParagraphs.map((para, i) => (
                  <p key={i} style={{ marginBottom: "1.25em", textIndent: i > 0 ? "1.5em" : "0" }}>
                    {renderClickableText(para.trim())}
                  </p>
                ))}

                {!effectiveTwoPageMode && pageIndex === totalPages - 1 && (
                  <p className="italic text-center opacity-40 text-xs mt-16 font-serif">
                    — End of Book —
                  </p>
                )}
              </div>

              {/* Running Footer */}
              <div
                className="flex items-center justify-between border-t pt-3 mt-6 text-xs"
                style={{ borderColor: currentTheme.border, color: currentTheme.subtext }}
              >
                <button
                  id="reading-prev-btn"
                  onClick={() => triggerPageTurn("prev")}
                  disabled={!hasPrevPage}
                  className="hover:opacity-100 opacity-60 flex items-center gap-1 transition disabled:opacity-20 font-medium"
                >
                  <ChevronLeft size={14} /> Previous
                </button>

                <span className={`${currentFont.cssClass} text-xs tracking-wider opacity-80 font-serif font-semibold`}>
                  — {leftPageIndex + 1} —
                </span>

                {/* In single page mode show Next button here */}
                {!effectiveTwoPageMode ? (
                  <button
                    id="reading-next-btn"
                    onClick={() => triggerPageTurn("next")}
                    disabled={!hasNextPage}
                    className="hover:opacity-100 opacity-90 font-medium flex items-center gap-1 transition text-amber-600 dark:text-amber-400 disabled:opacity-20"
                  >
                    Next <ChevronRight size={14} />
                  </button>
                ) : (
                  <span className="text-[10px] opacity-40 font-mono">
                    {Math.round(((leftPageIndex + 1) / totalPages) * 100)}%
                  </span>
                )}
              </div>

              {/* Page Curl Hover Visual */}
              {hasPrevPage && (
                <div
                  onClick={() => triggerPageTurn("prev")}
                  className="flipbook-curl-corner-left cursor-pointer hover:scale-125"
                  title="Turn to previous page"
                />
              )}

              {!effectiveTwoPageMode && hasNextPage && (
                <div
                  onClick={() => triggerPageTurn("next")}
                  className="flipbook-curl-corner-right cursor-pointer hover:scale-125"
                  title="Turn to next page"
                />
              )}
            </div>

            {/* Center Spine Crease (in 2-page mode) */}
            {effectiveTwoPageMode && (
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-10 flipbook-center-gutter z-10 pointer-events-none hidden md:block" />
            )}

            {/* RIGHT PAGE (in 2-page mode) */}
            {effectiveTwoPageMode && (
              <div
                className={`p-6 sm:p-8 md:p-10 flex flex-col justify-between min-h-[580px] relative flipbook-page-stack-right ${
                  isFlipping === "next" ? "animate-page-flip-next" : ""
                }`}
                style={{
                  boxShadow: `inset 18px 0 32px ${currentTheme.spine}`,
                }}
              >
                {/* Running Header */}
                <div
                  className="flex items-center justify-between border-b pb-2 mb-6 text-[11px]"
                  style={{ borderColor: currentTheme.border, color: currentTheme.subtext }}
                >
                  <span className="font-mono text-[9px] opacity-40 uppercase">Page {rightPageIndex + 1}</span>
                  <span className={`uppercase tracking-widest ${currentFont.cssClass} truncate max-w-[220px] font-semibold`}>
                    {authors}
                  </span>
                </div>

                {/* Page Body */}
                <div
                  className={`prose-reader ${currentFont.cssClass} flex-1`}
                  style={{
                    fontSize: `${fontSize}px`,
                    lineHeight: "1.85",
                    userSelect: "text",
                  }}
                >
                  {rightParagraphs.map((para, i) => (
                    <p
                      key={i}
                      style={{
                        marginBottom: "1.25em",
                        textIndent: i > 0 || leftParagraphs.length > 0 ? "1.5em" : "0",
                      }}
                    >
                      {renderClickableText(para.trim())}
                    </p>
                  ))}

                  {rightParagraphs.length === 0 && leftParagraphs.length > 0 && (
                    <p className="italic text-center opacity-40 text-xs mt-16 font-serif">
                      — End of Book —
                    </p>
                  )}
                </div>

                {/* Running Footer */}
                <div
                  className="flex items-center justify-between border-t pt-3 mt-6 text-xs"
                  style={{ borderColor: currentTheme.border, color: currentTheme.subtext }}
                >
                  <span className="text-[10px] opacity-40 font-mono">
                    {rightPageIndex < totalPages ? rightPageIndex + 1 : totalPages} / {totalPages}
                  </span>

                  <span className={`${currentFont.cssClass} text-xs tracking-wider opacity-80 font-serif font-semibold`}>
                    — {rightPageIndex + 1} —
                  </span>

                  <button
                    id="reading-next-btn"
                    onClick={() => triggerPageTurn("next")}
                    disabled={!hasNextPage}
                    className="hover:opacity-100 opacity-90 font-medium flex items-center gap-1 transition text-amber-600 dark:text-amber-400 disabled:opacity-20"
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </div>

                {/* Page Curl Hover Visual */}
                {hasNextPage && (
                  <div
                    onClick={() => triggerPageTurn("next")}
                    className="flipbook-curl-corner-right cursor-pointer hover:scale-125"
                    title="Turn to next page"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Bottom Page Scrub Controller */}
      {!showCheck && (
        <div className="bg-black/60 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/10 flex items-center gap-3 text-xs max-w-2xl mx-auto flex-wrap">
          <button
            onClick={() => goToPage(Math.max(0, pageIndex - 10))}
            disabled={pageIndex <= 0}
            className="text-neutral-400 hover:text-white disabled:opacity-30 p-1 flex items-center gap-0.5 transition"
            title="Jump back 10 pages"
          >
            <ChevronsLeft size={16} /> -10
          </button>

          <input
            type="range"
            min={0}
            max={Math.max(0, totalPages - 1)}
            value={pageIndex}
            onChange={(e) => goToPage(Number(e.target.value))}
            className="flex-1 accent-[var(--color-crimson)] h-1.5 bg-white/10 rounded-lg cursor-pointer"
          />

          <button
            onClick={() => goToPage(Math.min(totalPages - 1, pageIndex + 10))}
            disabled={pageIndex >= totalPages - 1}
            className="text-neutral-400 hover:text-white disabled:opacity-30 p-1 flex items-center gap-0.5 transition"
            title="Jump forward 10 pages"
          >
            +10 <ChevronsRight size={16} />
          </button>

          <div className="flex items-center gap-1 text-[11px] text-neutral-300 pl-2 border-l border-white/10">
            <span>Page</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={pageIndex + 1}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (val >= 1 && val <= totalPages) {
                  goToPage(val - 1);
                }
              }}
              className="w-12 bg-white/10 border border-white/15 rounded px-1.5 py-0.5 text-center text-white outline-none"
            />
            <span className="text-neutral-400">/ {totalPages}</span>
          </div>
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

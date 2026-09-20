import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  suggestBooksForLevel,
  fetchBookText,
  explainWordInContext,
  generateComprehensionCheck,
  searchGutendex,
  getOrEstimateBookMetadata,
  fetchBatchBookLevels,
  type ComprehensionQuestion,
  type GutendexBook,
  type GutendexResponse,
  type BookMetadataResult,
} from "@/lib/reading.functions";
import { CEFR_LEVELS, type CefrLevel } from "@/integrations/supabase/learner-profile.types";
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
  BookmarkCheck,
  Settings,
  Volume2,
  VolumeX,
  Play,
  Pause,
  List,
  Sliders,
  Sun,
  Moon,
  Trash2,
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
  estimatedLevel?: string;
}

function BookCard({ book, onClick, estimatedLevel }: BookCardProps) {
  const cover = getBookCover(book);
  const authors = getBookAuthors(book);
  const hasText = !!getBookTextUrl(book);

  return (
    <button
      id={`book-card-${book.id}`}
      onClick={() => onClick(book)}
      disabled={!hasText}
      className={`group glass-panel-soft p-0 overflow-hidden text-left flex flex-col transition-all duration-300 rounded-2xl relative ${
        hasText
          ? "hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(237,28,36,0.2)] hover:border-[var(--color-crimson)]/50 cursor-pointer"
          : "opacity-50 cursor-not-allowed"
      }`}
      title={!hasText ? "No readable text available for this book" : book.title}
    >
      {/* Level badge */}
      {estimatedLevel && (
        <span
          className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/70 border border-amber-400/40 text-amber-300 shadow backdrop-blur-sm"
          title="AI estimated reading difficulty"
        >
          ≈ {estimatedLevel}
        </span>
      )}

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

function BookPreviewModal({
  book,
  onClose,
  onStartReading,
}: {
  book: GutendexBook;
  onClose: () => void;
  onStartReading: (book: GutendexBook) => void;
}) {
  const getMetadataFn = useServerFn(getOrEstimateBookMetadata);
  const authors = getBookAuthors(book);
  const cover = getBookCover(book);

  const { data: metadata, isLoading } = useQuery({
    queryKey: ["book-metadata-preview", book.id],
    queryFn: async (): Promise<BookMetadataResult> => {
      return getMetadataFn({
        data: {
          bookId: book.id,
          title: book.title,
          author: authors,
          subjects: book.subjects,
        },
      });
    },
    staleTime: 10 * 60_000,
  });

  const estimatedPages = metadata?.wordCount
    ? Math.max(1, Math.round(metadata.wordCount / 260))
    : null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="glass-panel max-w-xl w-full p-6 border-amber-500/30 rounded-3xl space-y-6 relative shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-white rounded-full hover:bg-white/10 transition cursor-pointer"
          aria-label="Close preview"
        >
          <X size={18} />
        </button>

        <div className="flex flex-col sm:flex-row gap-5 items-start">
          {/* Cover */}
          <div className="w-28 sm:w-36 aspect-[2/3] bg-black/40 rounded-xl overflow-hidden shrink-0 border border-white/10 shadow-lg">
            {cover ? (
              <img src={cover} alt={book.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-neutral-900">
                <BookOpen size={32} className="text-amber-500/40" />
              </div>
            )}
          </div>

          {/* Book Header details */}
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/20 border border-amber-400/40 text-amber-300">
                ≈ {metadata?.estimatedLevel ?? "B1"}
              </span>
              <span className="text-[11px] text-neutral-400 italic">
                (AI estimate, confidence: {metadata?.confidence ?? "medium"})
              </span>
            </div>

            <h2 className="text-xl font-bold text-white leading-snug">{book.title}</h2>
            <p className="text-xs text-neutral-300 font-medium">{authors}</p>
            <p className="label-mono text-[10px] text-neutral-400">
              {book.download_count.toLocaleString()} Gutenberg downloads
            </p>
          </div>
        </div>

        {/* AI Plot Description */}
        <div className="space-y-2 border-t border-white/10 pt-4">
          <p className="label-mono text-xs text-amber-300 flex items-center gap-1.5">
            <Sparkles size={14} /> About this book
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-neutral-400 py-3">
              <Loader2 size={14} className="animate-spin text-amber-400" />
              Analyzing book topics & estimating length…
            </div>
          ) : (
            <p className="text-xs text-neutral-300 leading-relaxed font-serif">
              {metadata?.description ?? "A classic work of literature from Project Gutenberg."}
            </p>
          )}
        </div>

        {/* Length & Actions */}
        <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-4 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-neutral-400 font-mono">Estimated Length</p>
            <p className="text-xs font-semibold text-white mt-0.5">
              {metadata?.wordCount
                ? `~${metadata.wordCount.toLocaleString()} words (${estimatedPages} pages)`
                : "Standard book length"}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs border border-white/15 text-neutral-300 hover:text-white hover:bg-white/5 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onClose();
                onStartReading(book);
              }}
              className="btn-crimson px-5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-lg cursor-pointer"
            >
              <BookOpen size={14} /> Start Reading
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookBrowse({ onSelectBook }: { onSelectBook: (book: GutendexBook) => void }) {
  const userLevel = useCurrentLevel();
  const [selectedLevel, setSelectedLevel] = useState<string>("B1");
  const [previewBook, setPreviewBook] = useState<GutendexBook | null>(null);

  useEffect(() => {
    if (userLevel) setSelectedLevel(userLevel);
  }, [userLevel]);

  const suggestFn = useServerFn(suggestBooksForLevel);
  const searchGutendexFn = useServerFn(searchGutendex);
  const fetchBatchLevelsFn = useServerFn(fetchBatchBookLevels);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input (~300ms)
  function handleSearchChange(v: string) {
    setSearchQuery(v);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(v);
    }, 300);
  }

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // AI suggestions → resolved through Gutendex server function for selectedLevel
  const suggestionsQuery = useQuery({
    queryKey: ["book-suggestions", selectedLevel],
    queryFn: async (): Promise<GutendexBook[]> => {
      const { suggestions } = await suggestFn({
        data: { level: selectedLevel as "A1" | "A2" | "B1" | "B2" | "C1" | "C2" },
      });
      if (!suggestions.length) return [];

      // Resolve each suggestion through Gutendex (parallel, max 8)
      const resolved = await Promise.allSettled(
        suggestions.slice(0, 8).map(async (s) => {
          const query = `${s.title} ${s.author}`;
          const res = await searchGutendexFn({ data: { query, page: 1 } });
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
    staleTime: 5 * 60_000,
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

  // Batch difficulty lookup for displayed books
  const allDisplayedIds = useMemo(() => {
    const list = debouncedQuery.trim()
      ? searchResultsQuery.data ?? []
      : suggestionsQuery.data ?? [];
    return list.map((b) => b.id);
  }, [debouncedQuery, searchResultsQuery.data, suggestionsQuery.data]);

  const batchLevelsQuery = useQuery({
    queryKey: ["batch-book-levels", allDisplayedIds],
    queryFn: async () => {
      if (!allDisplayedIds.length) return {};
      const { estimates } = await fetchBatchLevelsFn({ data: { bookIds: allDisplayedIds } });
      return estimates;
    },
    enabled: allDisplayedIds.length > 0,
    staleTime: 10 * 60_000,
  });

  const levelMap = batchLevelsQuery.data ?? {};
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

      {/* CEFR Level Filter Pills */}
      <div className="space-y-2">
        <label className="label-mono text-neutral-400 text-xs block">Filter books by CEFR Level</label>
        <div className="flex flex-wrap gap-2">
          {CEFR_LEVELS.map((lvl) => {
            const active = selectedLevel === lvl;
            return (
              <button
                key={lvl}
                onClick={() => setSelectedLevel(lvl)}
                className={`px-4 py-1.5 rounded-full border text-xs font-bold transition-all cursor-pointer ${
                  active
                    ? "border-[color:var(--color-crimson-glow)] bg-[color:var(--color-crimson)]/20 text-white shadow-[0_0_12px_rgba(237,28,36,0.3)] scale-105"
                    : "border-[color:var(--color-border)] text-neutral-400 hover:border-white/30 hover:text-white"
                }`}
              >
                {lvl}
              </button>
            );
          })}
        </div>
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
          placeholder={`Search classics by title, author, or keyword (filtered for ${selectedLevel})…`}
          className="w-full bg-black/40 border border-[var(--color-border)]/60 rounded-2xl pl-12 pr-5 py-3.5 text-white placeholder-neutral-500 focus:outline-none focus:border-[var(--color-crimson)]/60 focus:ring-1 focus:ring-[var(--color-crimson)]/30 transition-all text-sm"
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
                <BookCard
                  key={book.id}
                  book={book}
                  onClick={(b) => setPreviewBook(b)}
                  estimatedLevel={levelMap[book.id]}
                />
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
              Suggested for level{" "}
              <span className="label-mono text-[var(--color-gold)] ml-2">{selectedLevel}</span>
            </h2>
            {suggestionsQuery.isLoading && (
              <Loader2 size={16} className="animate-spin text-neutral-400" />
            )}
          </div>

          {suggestionsQuery.isError && (
            <div className="flex items-center gap-2 text-sm text-red-400 py-4">
              <AlertCircle size={16} />
              Could not load suggestions for {selectedLevel}.
            </div>
          )}

          {suggestionsQuery.data && suggestionsQuery.data.length === 0 && !suggestionsQuery.isLoading && (
            <p className="text-muted-foreground text-sm py-4">
              No suggestions available for {selectedLevel} right now. Try searching for a title.
            </p>
          )}

          {suggestionsQuery.data && suggestionsQuery.data.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {suggestionsQuery.data.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  onClick={(b) => setPreviewBook(b)}
                  estimatedLevel={levelMap[book.id] ?? selectedLevel}
                />
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

      {/* Book Preview Modal */}
      {previewBook && (
        <BookPreviewModal
          book={previewBook}
          onClose={() => setPreviewBook(null)}
          onStartReading={(b) => {
            setPreviewBook(null);
            onSelectBook(b);
          }}
        />
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

type FontSizeStep = "S" | "M" | "L" | "XL";
type LineSpacingOption = "compact" | "comfortable" | "spacious";

const FONT_SIZE_MAP: Record<FontSizeStep, number> = {
  S: 14,
  M: 17,
  L: 20,
  XL: 23,
};

const LINE_SPACING_MAP: Record<LineSpacingOption, string> = {
  compact: "1.5",
  comfortable: "1.85",
  spacious: "2.2",
};

interface ReadingBookmark {
  id: string;
  user_id: string;
  gutenberg_book_id: number;
  chunk_index: number;
  label: string;
  created_at: string;
}

interface TOCItem {
  title: string;
  pageIndex: number;
}

interface SearchResultItem {
  pageIndex: number;
  prefix: string;
  matchText: string;
  suffix: string;
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
    name: "Pure Light",
    icon: "☀️",
    bg: "#ffffff",
    text: "#111827",
    subtext: "#4b5563",
    border: "#e5e7eb",
    stack: "#f3f4f6",
    spine: "rgba(0,0,0,0.06)",
    accent: "#2563eb",
    cover: "#1f2937",
  },
  dark: {
    id: "dark",
    name: "Velvet Night",
    icon: "🌙",
    bg: "#121212",
    text: "#e5e5e5",
    subtext: "#9ca3af",
    border: "#262626",
    stack: "#1a1a1a",
    spine: "rgba(0,0,0,0.50)",
    accent: "#fbbf24",
    cover: "#000000",
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

function extractTableOfContents(pages: string[]): TOCItem[] {
  const items: TOCItem[] = [];
  const seenTitles = new Set<string>();

  const chapterRegex =
    /^(?:chapter|act|book|part|section|canto|volume)\s+(?:[ivxlcdm\d]+|[a-z]+)(?::?\s+.*)?$/i;
  const standaloneHeaderRegex =
    /^(?:CHAPTER|ACT|BOOK|PART|SECTION|CANTO|PREFACE|PROLOGUE|EPILOGUE|CONTENTS|INTRODUCTION|FOREWORD)\b/i;
  const romanNumHeaderRegex = /^[IVXLCDM]+\.\s+[A-Z]/;

  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i];
    const lines = pageText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

    for (const line of lines) {
      if (line.length > 80) continue;

      if (
        chapterRegex.test(line) ||
        standaloneHeaderRegex.test(line) ||
        romanNumHeaderRegex.test(line)
      ) {
        const cleanTitle = line.replace(/\s+/g, " ").trim();
        const key = cleanTitle.toLowerCase();
        if (!seenTitles.has(key)) {
          seenTitles.add(key);
          items.push({ title: cleanTitle, pageIndex: i });
        }
        break;
      }
    }
  }

  return items;
}

function searchBookText(pages: string[], query: string): SearchResultItem[] {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];

  const results: SearchResultItem[] = [];
  const MAX_RESULTS = 40;

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx];
    const lowerText = pageText.toLowerCase();
    let pos = 0;

    while (pos < lowerText.length) {
      const matchIdx = lowerText.indexOf(q, pos);
      if (matchIdx === -1) break;

      const startContextPos = Math.max(0, matchIdx - 35);
      const endContextPos = Math.min(pageText.length, matchIdx + q.length + 35);

      let beforeStr = pageText.slice(startContextPos, matchIdx).replace(/\s+/g, " ");
      const matchStr = pageText.slice(matchIdx, matchIdx + q.length);
      let afterStr = pageText.slice(matchIdx + q.length, endContextPos).replace(/\s+/g, " ");

      if (startContextPos > 0) beforeStr = "…" + beforeStr;
      if (endContextPos < pageText.length) afterStr = afterStr + "…";

      results.push({
        pageIndex: pageIdx,
        prefix: beforeStr,
        matchText: matchStr,
        suffix: afterStr,
      });

      if (results.length >= MAX_RESULTS) return results;
      pos = matchIdx + q.length;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Text pagination helper — dynamic page fitting based on typography & device
// ---------------------------------------------------------------------------

function computeTargetWordsPerPage(
  fontSizeStep: FontSizeStep,
  lineSpacing: LineSpacingOption,
  isMobile: boolean
): number {
  const fontMultipliers: Record<FontSizeStep, number> = {
    S: 1.35,
    M: 1.0,
    L: 0.72,
    XL: 0.52,
  };
  const spacingMultipliers: Record<LineSpacingOption, number> = {
    compact: 1.15,
    comfortable: 1.0,
    spacious: 0.82,
  };

  const baseWords = 180;
  const words = Math.round(
    baseWords *
      (fontMultipliers[fontSizeStep] ?? 1.0) *
      (spacingMultipliers[lineSpacing] ?? 1.0) *
      (isMobile ? 0.75 : 1.0)
  );
  return Math.max(40, words);
}

function paginateTextIntoPages(fullText: string, targetWordsPerPage: number = 180): string[] {
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
  const minWords = Math.min(60, Math.floor(targetWordsPerPage * 0.4));

  for (const para of rawParagraphs) {
    const paraWords = para.split(/\s+/).length;

    // If single paragraph is longer than target page length, break into sentence blocks
    if (paraWords > targetWordsPerPage) {
      const sentences = para.match(/[^.!?]+[.!?]+(\s+|$)/g) || [para];
      for (const sentence of sentences) {
        const sentenceWords = sentence.split(/\s+/).length;
        if (currentWords + sentenceWords > targetWordsPerPage && currentWords >= minWords) {
          pages.push(currentParas.join("\n\n"));
          currentParas = [sentence.trim()];
          currentWords = sentenceWords;
        } else {
          currentParas.push(sentence.trim());
          currentWords += sentenceWords;
        }
      }
    } else {
      if (currentWords + paraWords > targetWordsPerPage && currentWords >= minWords) {
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

  const [rawFullText, setRawFullText] = useState<string>("");
  const [pages, setPages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [loadingText, setLoadingText] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reader customization state & preferences
  const [themeKey, setThemeKey] = useState<PaperThemeKey>("sepia");
  const [fontKey, setFontKey] = useState<FontKey>("merriweather");
  const [fontSizeStep, setFontSizeStep] = useState<FontSizeStep>("M");
  const [lineSpacing, setLineSpacing] = useState<LineSpacingOption>("comfortable");
  const [readAloudRate, setReadAloudRate] = useState<number>(1.0);
  const [twoPageMode, setTwoPageMode] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isFlipping, setIsFlipping] = useState<"next" | "prev" | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(false);

  // Focus mode state
  const [focusMode, setFocusMode] = useState<boolean>(false);

  // Panels state
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [bookmarksOpen, setBookmarksOpen] = useState<boolean>(false);
  const [tocOpen, setTocOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);

  // Bookmarks & TOC & Search state
  const [bookmarks, setBookmarks] = useState<ReadingBookmark[]>([]);
  const [tocItems, setTocItems] = useState<TOCItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);

  // Speech synthesis read-aloud state
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isSpeakingPaused, setIsSpeakingPaused] = useState<boolean>(false);
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState<number | null>(null);

  // Derived styling values
  const fontSize = FONT_SIZE_MAP[fontSizeStep];
  const lineHeightStr = LINE_SPACING_MAP[lineSpacing];

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

  // Load preferences from Supabase
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from("reading_preferences")
          .select("font_size, line_spacing, theme, read_aloud_rate")
          .eq("user_id", user.id)
          .maybeSingle();
        if (data) {
          if (data.font_size && (data.font_size as FontSizeStep) in FONT_SIZE_MAP) {
            setFontSizeStep(data.font_size as FontSizeStep);
          }
          if (data.line_spacing && (data.line_spacing as LineSpacingOption) in LINE_SPACING_MAP) {
            setLineSpacing(data.line_spacing as LineSpacingOption);
          }
          if (data.theme && PAPER_THEMES[data.theme as PaperThemeKey]) {
            setThemeKey(data.theme as PaperThemeKey);
          }
          if (typeof data.read_aloud_rate === "number") {
            setReadAloudRate(data.read_aloud_rate);
          }
        }
      } catch {
        // default settings stick
      }
    })();
  }, []);

  async function updateAndSavePreferences(updates: {
    fontSizeStep?: FontSizeStep;
    lineSpacing?: LineSpacingOption;
    themeKey?: PaperThemeKey;
    readAloudRate?: number;
  }) {
    if (updates.fontSizeStep) setFontSizeStep(updates.fontSizeStep);
    if (updates.lineSpacing) setLineSpacing(updates.lineSpacing);
    if (updates.themeKey) setThemeKey(updates.themeKey);
    if (updates.readAloudRate) setReadAloudRate(updates.readAloudRate);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const fStep = updates.fontSizeStep ?? fontSizeStep;
      const lSpace = updates.lineSpacing ?? lineSpacing;
      const thKey = updates.themeKey ?? themeKey;
      const rate = updates.readAloudRate ?? readAloudRate;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("reading_preferences").upsert(
        {
          user_id: user.id,
          font_size: fStep,
          line_spacing: lSpace,
          theme: thKey,
          read_aloud_rate: rate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    } catch {
      // ignore persistence error
    }
  }

  // Bookmarks handling
  async function loadBookmarks() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("reading_bookmarks")
        .select("*")
        .eq("user_id", user.id)
        .eq("gutenberg_book_id", book.id)
        .order("created_at", { ascending: false });
      if (!error && data) {
        setBookmarks(data as ReadingBookmark[]);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadBookmarks();
  }, [book.id]);

  const isCurrentPageBookmarked = bookmarks.some((b) => b.chunk_index === pageIndex);

  async function handleToggleBookmark() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const existing = bookmarks.find((b) => b.chunk_index === pageIndex);
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from("reading_bookmarks").delete().eq("id", existing.id);
        setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));
        toast.success("Bookmark removed");
      } else {
        const pageText = pages[pageIndex] ?? "";
        const snippet = pageText.slice(0, 45).replace(/\n/g, " ").trim();
        const label = snippet ? `"${snippet}…"` : `Page ${pageIndex + 1}`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from("reading_bookmarks")
          .insert({
            user_id: user.id,
            gutenberg_book_id: book.id,
            chunk_index: pageIndex,
            label,
          })
          .select()
          .single();

        if (!error && data) {
          setBookmarks((prev) => [data as ReadingBookmark, ...prev]);
          toast.success(`Bookmarked page ${pageIndex + 1}`);
        }
      }
    } catch {
      toast.error("Could not save bookmark");
    }
  }

  async function handleDeleteBookmark(bookmarkId: string) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("reading_bookmarks").delete().eq("id", bookmarkId);
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
      toast.success("Bookmark removed");
    } catch {
      // ignore
    }
  }

  // Extract Table of Contents whenever pages update
  useEffect(() => {
    if (pages.length > 0) {
      const items = extractTableOfContents(pages);
      setTocItems(items);
    }
  }, [pages]);

  // In-book search computation
  useEffect(() => {
    if (searchQuery.trim().length >= 2) {
      const results = searchBookText(pages, searchQuery);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, pages]);

  // Load & save reading progress
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
        setRawFullText(fullText);

        const targetWords = computeTargetWordsPerPage(fontSizeStep, lineSpacing, isMobile);
        const bookPages = paginateTextIntoPages(fullText, targetWords);
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

  // Dynamic re-pagination on typography/screen resize
  const prevSettingsRef = useRef({ fontSizeStep, lineSpacing, isMobile });
  useEffect(() => {
    if (!rawFullText) return;
    const prev = prevSettingsRef.current;
    if (
      prev.fontSizeStep === fontSizeStep &&
      prev.lineSpacing === lineSpacing &&
      prev.isMobile === isMobile
    ) {
      return;
    }
    prevSettingsRef.current = { fontSizeStep, lineSpacing, isMobile };

    const targetWords = computeTargetWordsPerPage(fontSizeStep, lineSpacing, isMobile);
    const newPages = paginateTextIntoPages(rawFullText, targetWords);

    if (pages.length > 0) {
      const ratio = pageIndex / Math.max(1, pages.length);
      const newIdx = Math.min(newPages.length - 1, Math.max(0, Math.floor(ratio * newPages.length)));
      setPageIndex(newIdx);
    }
    setPages(newPages);
  }, [rawFullText, fontSizeStep, lineSpacing, isMobile, pages.length, pageIndex]);

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

  // Content for left & right pages
  const leftText = pages[leftPageIndex] ?? "";
  const rightText = twoPageMode && rightPageIndex < totalPages ? (pages[rightPageIndex] ?? "") : "";

  // Page-level Read-Aloud (SpeechSynthesis)
  function stopReadAloud() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsSpeakingPaused(false);
    setCurrentSentenceIdx(null);
  }

  function startReadAloud() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast.error("Speech synthesis is not supported in your browser.");
      return;
    }

    window.speechSynthesis.cancel();

    const textToRead = effectiveTwoPageMode
      ? `${leftText}. ${rightText}`
      : leftText;

    if (!textToRead.trim()) return;

    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.lang = "en-US";
    utterance.rate = readAloudRate;

    const sentenceMatches = textToRead.match(/[^.!?]+[.!?]+(\s+|$)/g) || [textToRead];
    let accum = 0;
    const sentenceRanges = sentenceMatches.map((s) => {
      const start = accum;
      const end = accum + s.length;
      accum = end;
      return { start, end };
    });

    utterance.onboundary = (event) => {
      if (event.name === "sentence" || event.charIndex !== undefined) {
        const idx = sentenceRanges.findIndex(
          (r) => event.charIndex >= r.start && event.charIndex < r.end
        );
        if (idx !== -1) {
          setCurrentSentenceIdx(idx);
        }
      }
    };

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsSpeakingPaused(false);
    };

    utterance.onpause = () => {
      setIsSpeakingPaused(true);
    };

    utterance.onresume = () => {
      setIsSpeakingPaused(false);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsSpeakingPaused(false);
      setCurrentSentenceIdx(null);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsSpeakingPaused(false);
      setCurrentSentenceIdx(null);
    };

    window.speechSynthesis.speak(utterance);
  }

  function togglePauseReadAloud() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      if (isSpeakingPaused) {
        window.speechSynthesis.resume();
        setIsSpeakingPaused(false);
      } else if (isSpeaking) {
        window.speechSynthesis.pause();
        setIsSpeakingPaused(true);
      }
    }
  }

  useEffect(() => {
    stopReadAloud();
  }, [pageIndex, book.id]);

  useEffect(() => {
    return () => {
      stopReadAloud();
    };
  }, []);

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
      if (showCheck || popover || searchOpen) return;
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
  }, [pageIndex, totalPages, showCheck, popover, isFlipping, twoPageMode, searchOpen]);

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

  const leftParagraphs = leftText.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const rightParagraphs = rightText.split(/\n\n+/).filter((p) => p.trim().length > 0);

  const displayProgressPage = effectiveTwoPageMode ? leftPageIndex + 1 : pageIndex + 1;

  return (
    <div
      className={`flipbook-stage w-full transition-all duration-300 ${
        focusMode
          ? "fixed inset-0 z-[190] bg-neutral-950 p-4 sm:p-8 overflow-y-auto flex flex-col justify-between"
          : isFullscreen
            ? "fixed inset-0 z-[150] bg-black/90 p-4 sm:p-8 overflow-y-auto flex flex-col justify-center"
            : "max-w-6xl mx-auto space-y-5"
      }`}
    >
      {/* Floating Exit Button in Focus Mode */}
      {focusMode && (
        <button
          id="exit-focus-mode-btn"
          onClick={() => setFocusMode(false)}
          className="fixed top-4 right-6 z-[210] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-900/90 hover:bg-neutral-800 text-white text-xs border border-white/20 shadow-2xl cursor-pointer transition-all hover:scale-105 active:scale-95"
        >
          <X size={14} className="text-amber-400" />
          <span className="font-medium">Exit focus mode</span>
        </button>
      )}

      {/* Top Header Control Toolbar */}
      {!focusMode && (
        <div className="flex items-center justify-between gap-2 bg-black/60 backdrop-blur-md p-2.5 rounded-2xl border border-white/10 text-xs flex-wrap">
          {/* Back button & title */}
          <div className="flex items-center gap-2">
            <button
              id="reading-back-btn"
              onClick={onBack}
              className="flex items-center gap-1 text-neutral-300 hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/10"
            >
              <ChevronLeft size={16} /> <span className="hidden sm:inline">Library</span>
            </button>

            <div className="hidden xl:block max-w-[180px] truncate">
              <p className="font-semibold text-white truncate text-xs">{book.title}</p>
              <p className="text-[10px] text-neutral-400 truncate">{authors}</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Search in book */}
            <button
              id="reading-search-btn"
              onClick={() => {
                setSearchOpen(!searchOpen);
                setSettingsOpen(false);
                setBookmarksOpen(false);
                setTocOpen(false);
              }}
              className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border ${
                searchOpen
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-white/5 border-white/10 text-neutral-300 hover:text-white hover:bg-white/10"
              }`}
              title="Search in this book"
            >
              <Search size={14} />
              <span className="hidden sm:inline">Search</span>
            </button>

            {/* Table of Contents (hidden if no chapters detected) */}
            {tocItems.length > 0 && (
              <button
                id="reading-toc-btn"
                onClick={() => {
                  setTocOpen(!tocOpen);
                  setSettingsOpen(false);
                  setBookmarksOpen(false);
                  setSearchOpen(false);
                }}
                className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border ${
                  tocOpen
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                    : "bg-white/5 border-white/10 text-neutral-300 hover:text-white hover:bg-white/10"
                }`}
                title="Table of contents"
              >
                <List size={14} />
                <span className="hidden sm:inline">Contents</span>
                <span className="bg-white/10 px-1.5 py-0.2 text-[10px] rounded-full">
                  {tocItems.length}
                </span>
              </button>
            )}

            {/* Bookmark page toggle */}
            <button
              id="reading-bookmark-page-btn"
              onClick={handleToggleBookmark}
              className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border ${
                isCurrentPageBookmarked
                  ? "bg-amber-500/30 text-amber-300 border-amber-400/50"
                  : "bg-white/5 border-white/10 text-neutral-300 hover:text-white hover:bg-white/10"
              }`}
              title={isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark page"}
            >
              {isCurrentPageBookmarked ? (
                <BookmarkCheck size={14} className="text-amber-400" />
              ) : (
                <Bookmark size={14} />
              )}
              <span className="hidden sm:inline">
                {isCurrentPageBookmarked ? "Bookmarked" : "Bookmark"}
              </span>
            </button>

            {/* Bookmarks drawer list */}
            <button
              id="reading-bookmarks-list-btn"
              onClick={() => {
                setBookmarksOpen(!bookmarksOpen);
                setSettingsOpen(false);
                setTocOpen(false);
                setSearchOpen(false);
              }}
              className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border ${
                bookmarksOpen
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-white/5 border-white/10 text-neutral-300 hover:text-white hover:bg-white/10"
              }`}
              title="Saved bookmarks"
            >
              <Bookmark size={14} />
              <span className="hidden md:inline">Bookmarks</span>
              {bookmarks.length > 0 && (
                <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.2 text-[10px] rounded-full font-bold">
                  {bookmarks.length}
                </span>
              )}
            </button>

            {/* Page Read-Aloud Controls */}
            <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10">
              {!isSpeaking ? (
                <button
                  id="reading-read-aloud-start-btn"
                  onClick={startReadAloud}
                  className="px-2 py-1 rounded text-neutral-300 hover:text-white hover:bg-white/10 flex items-center gap-1 transition"
                  title="Read page aloud"
                >
                  <Volume2 size={14} className="text-amber-400" />
                  <span className="hidden md:inline">Read aloud</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={togglePauseReadAloud}
                    className="px-2 py-1 rounded text-amber-300 hover:bg-white/10 flex items-center gap-1 transition"
                    title={isSpeakingPaused ? "Resume speech" : "Pause speech"}
                  >
                    {isSpeakingPaused ? <Play size={14} /> : <Pause size={14} />}
                    <span className="hidden md:inline">{isSpeakingPaused ? "Resume" : "Pause"}</span>
                  </button>
                  <button
                    onClick={stopReadAloud}
                    className="px-2 py-1 rounded text-red-400 hover:bg-white/10 flex items-center gap-1 transition"
                    title="Stop speech"
                  >
                    <Square size={12} fill="currentColor" />
                  </button>
                </>
              )}
            </div>

            {/* Focus Mode button */}
            <button
              id="reading-focus-mode-btn"
              onClick={() => setFocusMode(true)}
              className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-neutral-300 hover:text-white hover:bg-white/10 transition text-xs flex items-center gap-1.5"
              title="Enter full-screen focus mode"
            >
              <Maximize2 size={14} />
              <span className="hidden lg:inline">Focus mode</span>
            </button>

            {/* Settings button */}
            <button
              id="reading-settings-btn"
              onClick={() => {
                setSettingsOpen(!settingsOpen);
                setBookmarksOpen(false);
                setTocOpen(false);
                setSearchOpen(false);
              }}
              className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border ${
                settingsOpen
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-white/5 border-white/10 text-neutral-300 hover:text-white hover:bg-white/10"
              }`}
              title="Reading settings"
            >
              <Settings size={14} />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>
      )}

      {/* Reading Settings Panel */}
      {settingsOpen && !focusMode && (
        <div className="glass-panel p-4 border border-amber-500/30 rounded-2xl space-y-4 max-w-lg mx-auto animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
              <Settings size={16} />
              <span>⚙️ Reading Settings</span>
            </div>
            <button
              onClick={() => setSettingsOpen(false)}
              className="text-neutral-400 hover:text-white p-1 rounded-lg transition"
            >
              <X size={16} />
            </button>
          </div>

          {/* Font Size Step */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
              <Type size={14} className="text-amber-400" />
              <span>Font Size</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(["S", "M", "L", "XL"] as FontSizeStep[]).map((step) => (
                <button
                  key={step}
                  onClick={() => void updateAndSavePreferences({ fontSizeStep: step })}
                  className={`py-1.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    fontSizeStep === step
                      ? "bg-amber-500/20 border-amber-400 text-amber-300 shadow"
                      : "bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {step} ({FONT_SIZE_MAP[step]}px)
                </button>
              ))}
            </div>
          </div>

          {/* Line Spacing Step */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
              <Sliders size={14} className="text-amber-400" />
              <span>Line Spacing</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["compact", "comfortable", "spacious"] as LineSpacingOption[]).map((option) => (
                <button
                  key={option}
                  onClick={() => void updateAndSavePreferences({ lineSpacing: option })}
                  className={`py-1.5 px-3 rounded-xl border text-xs font-medium capitalize transition ${
                    lineSpacing === option
                      ? "bg-amber-500/20 border-amber-400 text-amber-300 shadow"
                      : "bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {/* Page Theme */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
              <Palette size={14} className="text-amber-400" />
              <span>Page Theme</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.keys(PAPER_THEMES) as PaperThemeKey[]).map((key) => {
                const th = PAPER_THEMES[key];
                return (
                  <button
                    key={key}
                    onClick={() => void updateAndSavePreferences({ themeKey: key })}
                    className={`p-2 rounded-xl border text-xs flex items-center gap-2 transition ${
                      themeKey === key
                        ? "border-amber-400 ring-2 ring-amber-400/20 shadow-md"
                        : "border-white/10 hover:border-white/30"
                    }`}
                    style={{ backgroundColor: th.bg, color: th.text }}
                  >
                    <span>{th.icon}</span>
                    <span className="font-semibold truncate">{th.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Read-Aloud Speed Rate */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
              <Volume2 size={14} className="text-amber-400" />
              <span>Read-Aloud Speed Rate</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[0.8, 1.0, 1.25, 1.5].map((rate) => (
                <button
                  key={rate}
                  onClick={() => void updateAndSavePreferences({ readAloudRate: rate })}
                  className={`py-1.5 px-2 rounded-xl border text-xs font-semibold transition ${
                    readAloudRate === rate
                      ? "bg-amber-500/20 border-amber-400 text-amber-300 shadow"
                      : "bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bookmarks Drawer */}
      {bookmarksOpen && !focusMode && (
        <div className="glass-panel p-4 border border-amber-500/30 rounded-2xl space-y-3 max-w-lg mx-auto animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
              <Bookmark size={16} />
              <span>🔖 Saved Bookmarks ({bookmarks.length})</span>
            </div>
            <button
              onClick={() => setBookmarksOpen(false)}
              className="text-neutral-400 hover:text-white p-1 rounded-lg transition"
            >
              <X size={16} />
            </button>
          </div>

          {bookmarks.length === 0 ? (
            <p className="text-xs text-neutral-400 py-4 text-center">
              No bookmarks saved for this book yet. Click "Bookmark" in the toolbar to save pages.
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white">Page {bm.chunk_index + 1}</p>
                    <p className="text-[11px] text-neutral-300 truncate">{bm.label}</p>
                    <p className="text-[9px] text-neutral-500">
                      {new Date(bm.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        goToPage(bm.chunk_index);
                        setBookmarksOpen(false);
                      }}
                      className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs rounded-lg transition font-medium"
                    >
                      Jump →
                    </button>
                    <button
                      onClick={() => void handleDeleteBookmark(bm.id)}
                      className="p-1 text-neutral-400 hover:text-red-400 transition rounded-lg"
                      title="Delete bookmark"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table of Contents Drawer */}
      {tocOpen && !focusMode && (
        <div className="glass-panel p-4 border border-amber-500/30 rounded-2xl space-y-3 max-w-lg mx-auto animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
              <List size={16} />
              <span>📑 Table of Contents ({tocItems.length})</span>
            </div>
            <button
              onClick={() => setTocOpen(false)}
              className="text-neutral-400 hover:text-white p-1 rounded-lg transition"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {tocItems.map((item, idx) => (
              <button
                key={idx}
                onClick={() => {
                  goToPage(item.pageIndex);
                  setTocOpen(false);
                }}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-white/5 hover:bg-white/10 text-left transition group border border-transparent hover:border-white/10"
              >
                <span className="text-xs text-neutral-200 group-hover:text-amber-300 transition line-clamp-1 font-medium">
                  {item.title}
                </span>
                <span className="text-[10px] text-neutral-400 font-mono ml-2 shrink-0">
                  Page {item.pageIndex + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* In-Book Search Modal */}
      {searchOpen && !focusMode && (
        <div className="glass-panel p-4 border border-amber-500/30 rounded-2xl space-y-3 max-w-xl mx-auto animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
              <Search size={16} />
              <span>🔍 Search in Book</span>
            </div>
            <button
              onClick={() => setSearchOpen(false)}
              className="text-neutral-400 hover:text-white p-1 rounded-lg transition"
            >
              <X size={16} />
            </button>
          </div>

          <div className="relative">
            <input
              type="text"
              placeholder="Type a word or phrase to search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="w-full bg-black/40 border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white placeholder-neutral-500 outline-none focus:border-amber-400 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-2.5 text-neutral-400 hover:text-white text-xs"
              >
                Clear
              </button>
            )}
          </div>

          {searchQuery.trim().length >= 2 && (
            <p className="text-[11px] text-neutral-400">
              Found {searchResults.length} match{searchResults.length === 1 ? "" : "es"}
            </p>
          )}

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {searchResults.map((res, idx) => (
              <button
                key={idx}
                onClick={() => {
                  goToPage(res.pageIndex);
                  setSearchOpen(false);
                }}
                className="w-full text-left p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition flex flex-col gap-1 group"
              >
                <div className="flex items-center justify-between text-[10px] text-amber-400 font-mono">
                  <span>Match #{idx + 1}</span>
                  <span>Page {res.pageIndex + 1} →</span>
                </div>
                <p className="text-xs text-neutral-300 font-serif leading-normal group-hover:text-white transition">
                  <span>{res.prefix}</span>
                  <mark className="bg-amber-400/30 text-amber-200 px-0.5 rounded font-bold">
                    {res.matchText}
                  </mark>
                  <span>{res.suffix}</span>
                </p>
              </button>
            ))}
            {searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <p className="text-xs text-neutral-400 py-4 text-center">No matches found for "{searchQuery}".</p>
            )}
          </div>
        </div>
      )}

      {/* Progress Indicator */}
      {!focusMode && (
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
      )}

      {/* Comprehension Check Modal */}
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
            className="absolute top-0 right-14 w-4 h-24 z-30 shadow-lg rounded-b flex items-end justify-center pb-1 cursor-pointer transition-transform hover:scale-105"
            onClick={handleToggleBookmark}
            title={isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark current page"}
            style={{
              background: isCurrentPageBookmarked
                ? "linear-gradient(to bottom, #f59e0b, #d97706)"
                : `linear-gradient(to bottom, ${currentTheme.accent}, #650000)`,
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
                className={`prose-reader ${currentFont.cssClass} flex-1 overflow-hidden`}
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight: lineHeightStr,
                  userSelect: "text",
                }}
              >
                {leftParagraphs.map((para, i) => (
                  <p
                    key={i}
                    style={{ marginBottom: "1.25em", textIndent: i > 0 ? "1.5em" : "0" }}
                    className={
                      isSpeaking && currentSentenceIdx !== null
                        ? "transition-colors duration-200"
                        : ""
                    }
                  >
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
                  className={`prose-reader ${currentFont.cssClass} flex-1 overflow-hidden`}
                  style={{
                    fontSize: `${fontSize}px`,
                    lineHeight: lineHeightStr,
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
      {!showCheck && !focusMode && (
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

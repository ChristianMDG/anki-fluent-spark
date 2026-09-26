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
  Type,
  Palette,
  Square,
  Bookmark,
  BookmarkCheck,
  Settings,
  Volume2,
  Play,
  Pause,
  List,
  Sliders,
  RotateCcw,
  User,
  Clock,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/reading")({
  component: ReadingPage,
});

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

interface TopicCategory {
  id: string;
  label: string;
  queryTopic: string;
  icon: string;
  color: string;
}

const TOPIC_CATEGORIES: TopicCategory[] = [
  { id: "fiction", label: "Fiction", queryTopic: "fiction", icon: "📚", color: "from-amber-500/20 to-orange-500/10" },
  { id: "adventure", label: "Adventure", queryTopic: "adventure", icon: "⚔️", color: "from-red-500/20 to-amber-500/10" },
  { id: "romance", label: "Romance", queryTopic: "romance", icon: "🌹", color: "from-rose-500/20 to-pink-500/10" },
  { id: "mystery", label: "Mystery & Crime", queryTopic: "detective", icon: "🔍", color: "from-purple-500/20 to-indigo-500/10" },
  { id: "philosophy", label: "Philosophy", queryTopic: "philosophy", icon: "🧠", color: "from-blue-500/20 to-cyan-500/10" },
  { id: "poetry", label: "Poetry", queryTopic: "poetry", icon: "✍️", color: "from-emerald-500/20 to-teal-500/10" },
  { id: "science", label: "Science & Sci-Fi", queryTopic: "science", icon: "🚀", color: "from-sky-500/20 to-blue-500/10" },
  { id: "history", label: "History", queryTopic: "history", icon: "🏛️", color: "from-yellow-500/20 to-amber-500/10" },
  { id: "children", label: "Children's", queryTopic: "children", icon: "🧸", color: "from-lime-500/20 to-green-500/10" },
  { id: "drama", label: "Plays & Drama", queryTopic: "drama", icon: "🎭", color: "from-fuchsia-500/20 to-purple-500/10" },
];

export type SortMode = "popular" | "title" | "author";

interface ProgressItem {
  id: string;
  user_id: string;
  gutenberg_book_id: number;
  book_title: string;
  current_chunk_index: number;
  total_chunks: number;
  updated_at: string | null;
}

interface CachedBookData {
  bookId: number;
  rawText: string;
  targetWords: number;
  pages: string[];
}

// Global in-memory cache for loaded book texts & computed pagination
const bookTextCache = new Map<number, CachedBookData>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBookCover(book: GutendexBook): string | null {
  if (!book || !book.formats) return null;
  for (const key of Object.keys(book.formats)) {
    if (key.includes("image/jpeg") || key === "image/jpeg") {
      return book.formats[key];
    }
  }
  return null;
}

function getBookTextUrl(book: GutendexBook): string {
  if (!book || !book.formats) return "";
  for (const [key, val] of Object.entries(book.formats)) {
    if (key.startsWith("text/plain") && val) {
      return val.replace(/^http:/, "https:");
    }
  }
  return `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.txt`;
}

function getBookAuthors(book: GutendexBook): string {
  if (!book.authors || book.authors.length === 0) return "Unknown Author";
  return book.authors.map((a) => a.name.split(",").reverse().join(" ").trim()).join(", ");
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

        const { data: profile, error } = await supabase
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
  onAuthorClick?: (author: string) => void;
  estimatedLevel?: string;
}

function BookCard({ book, onClick, onAuthorClick, estimatedLevel }: BookCardProps) {
  const [imageError, setImageError] = useState(false);
  const cover = imageError ? null : getBookCover(book);
  const authors = getBookAuthors(book);
  const hasText = !!getBookTextUrl(book);

  return (
    <div
      className={`group glass-panel-soft p-0 overflow-hidden text-left flex flex-col transition-all duration-300 rounded-2xl relative motion-reduce:transition-none ${
        hasText
          ? "hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(237,28,36,0.2)] hover:border-[var(--color-crimson)]/50"
          : "opacity-50"
      }`}
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

      {/* Cover image or clean styled placeholder */}
      <button
        id={`book-card-${book.id}`}
        onClick={() => onClick(book)}
        disabled={!hasText}
        className="w-full aspect-[2/3] bg-black/40 overflow-hidden flex-shrink-0 relative cursor-pointer text-left focus:outline-none"
        title={!hasText ? "No readable text available for this book" : book.title}
      >
        {cover ? (
          <img
            src={cover}
            alt={`Cover of ${book.title}`}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col justify-between p-4 bg-gradient-to-br from-[#1a0808] via-[#2a1010] to-[#120606] relative border-b border-white/5">
            <div className="w-full h-1 bg-amber-500/40 rounded-full opacity-60" />
            <div className="my-auto space-y-2 text-center">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
                <BookOpen size={20} />
              </div>
              <p className="text-xs font-serif font-semibold text-white/90 line-clamp-3 leading-snug px-1">
                {book.title}
              </p>
              <p className="text-[10px] text-amber-400/80 font-mono truncate px-1">{authors}</p>
            </div>
            <div className="w-full h-1 bg-amber-500/40 rounded-full opacity-60" />
          </div>
        )}
        {!hasText && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center">
            <span className="label-mono text-[10px] text-neutral-300 bg-black/70 px-2 py-1 rounded">No text available</span>
          </div>
        )}
      </button>

      {/* Info */}
      <div className="p-3 flex-1 flex flex-col gap-1 min-h-0">
        <button
          onClick={() => onClick(book)}
          disabled={!hasText}
          className="text-left font-semibold text-sm leading-snug line-clamp-2 text-white group-hover:text-[var(--color-gold)] transition-colors duration-200 cursor-pointer"
        >
          {book.title}
        </button>

        {onAuthorClick ? (
          <button
            onClick={() => onAuthorClick(authors)}
            className="text-left text-xs text-neutral-400 hover:text-amber-300 transition-colors line-clamp-1 cursor-pointer flex items-center gap-1"
            title={`Browse works by ${authors}`}
          >
            <User size={10} className="shrink-0 text-neutral-500" />
            <span className="truncate">{authors}</span>
          </button>
        ) : (
          <p className="text-xs text-neutral-400 line-clamp-1">{authors}</p>
        )}

        <p className="label-mono text-[9px] mt-auto text-neutral-500 pt-1">
          {book.download_count.toLocaleString()} downloads
        </p>
      </div>
    </div>
  );
}

function BookPreviewModal({
  book,
  onClose,
  onStartReading,
  onAuthorClick,
}: {
  book: GutendexBook;
  onClose: () => void;
  onStartReading: (book: GutendexBook) => void;
  onAuthorClick: (author: string) => void;
}) {
  const getMetadataFn = useServerFn(getOrEstimateBookMetadata);
  const authors = getBookAuthors(book);
  const [imageError, setImageError] = useState(false);
  const cover = imageError ? null : getBookCover(book);

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
          <div className="w-28 sm:w-36 aspect-[2/3] bg-black/40 rounded-xl overflow-hidden shrink-0 border border-white/10 shadow-lg relative">
            {cover ? (
              <img
                src={cover}
                alt={book.title}
                onError={() => setImageError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-br from-[#1a0808] to-[#2d0f0f] text-center">
                <BookOpen size={32} className="text-amber-500/50 mb-2" />
                <p className="text-[10px] font-serif font-semibold text-white/80 line-clamp-3">{book.title}</p>
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

            {/* Clickable Author */}
            <button
              onClick={() => {
                onClose();
                onAuthorClick(authors);
              }}
              className="text-xs text-amber-400 hover:text-amber-300 hover:underline font-medium cursor-pointer flex items-center gap-1.5"
              title="Search all works by this author"
            >
              <User size={12} />
              <span>{authors}</span>
              <span className="text-[10px] text-neutral-400 font-normal">(browse author →)</span>
            </button>

            <p className="label-mono text-[10px] text-neutral-400 pt-1">
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
              className="px-4 py-2 rounded-xl text-xs border border-white/15 text-neutral-300 hover:text-white hover:bg-white/5 transition cursor-pointer"
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
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("popular");
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [previewBook, setPreviewBook] = useState<GutendexBook | null>(null);

  const suggestFn = useServerFn(suggestBooksForLevel);
  const searchGutendexFn = useServerFn(searchGutendex);
  const fetchBatchLevelsFn = useServerFn(fetchBatchBookLevels);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input (300ms)
  function handleSearchChange(v: string) {
    setSearchQuery(v);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(v);
      setCurrentPage(1);
    }, 300);
  }

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // Continue Reading shelf query from Supabase reading_progress table
  const continueReadingQuery = useQuery({
    queryKey: ["reading-progress-shelf"],
    queryFn: async (): Promise<ProgressItem[]> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return [];

        const { data, error } = await supabase
          .from("reading_progress")
          .select("*")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(6);

        if (error || !data) return [];
        return data as ProgressItem[];
      } catch {
        return [];
      }
    },
    staleTime: 10_000,
  });

  // Resolve Gutenberg book details for Continue Reading shelf items
  const continueReadingBookIds = useMemo(() => {
    return (continueReadingQuery.data ?? []).map((p) => p.gutenberg_book_id);
  }, [continueReadingQuery.data]);

  const resolvedContinueBooksQuery = useQuery({
    queryKey: ["resolved-continue-books", continueReadingBookIds],
    queryFn: async (): Promise<Record<number, GutendexBook>> => {
      if (!continueReadingBookIds.length) return {};
      try {
        const res = await searchGutendexFn({
          data: { ids: continueReadingBookIds.join(",") },
        });
        const map: Record<number, GutendexBook> = {};
        for (const book of res.results) {
          map[book.id] = book;
        }
        return map;
      } catch {
        return {};
      }
    },
    enabled: continueReadingBookIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // Main Gutendex books query (search, topic, or level suggestions)
  const isSearching = !!debouncedQuery.trim();

  const booksQuery = useQuery({
    queryKey: [
      "gutendex-browse",
      debouncedQuery,
      selectedTopic,
      selectedLevel,
      currentPage,
      sortMode,
    ],
    queryFn: async (): Promise<GutendexResponse> => {
      let gutendexSortParam: "popular" | "ascending" | "descending" | undefined = undefined;
      if (sortMode === "popular") gutendexSortParam = "popular";

      if (debouncedQuery.trim()) {
        return searchGutendexFn({
          data: {
            query: debouncedQuery.trim(),
            topic: selectedTopic ?? undefined,
            sort: gutendexSortParam,
            page: currentPage,
          },
        });
      }

      if (selectedTopic) {
        return searchGutendexFn({
          data: {
            topic: selectedTopic,
            sort: gutendexSortParam,
            page: currentPage,
          },
        });
      }

      // Default suggestions for CEFR level (or general popular)
      const targetLvl = selectedLevel || userLevel || "B1";
      const { suggestions } = await suggestFn({
        data: { level: targetLvl as "A1" | "A2" | "B1" | "B2" | "C1" | "C2" },
      });

      if (suggestions.length > 0) {
        const resolved = await Promise.allSettled(
          suggestions.slice(0, 12).map(async (s) => {
            const query = `${s.title} ${s.author}`;
            const res = await searchGutendexFn({ data: { query, page: 1 } });
            const match = res.results.find((b) => getBookTextUrl(b));
            return match ?? null;
          }),
        );

        const results = resolved
          .filter(
            (r): r is PromiseFulfilledResult<GutendexBook> =>
              r.status === "fulfilled" && r.value !== null,
          )
          .map((r) => r.value);

        return {
          count: results.length,
          next: null,
          previous: null,
          results,
        };
      }

      // Fallback popular books query
      return searchGutendexFn({
        data: {
          sort: "popular",
          page: currentPage,
        },
      });
    },
    staleTime: 3 * 60_000,
  });

  // Process & sort results
  const rawResults = booksQuery.data?.results ?? [];
  const processedResults = useMemo(() => {
    const list = [...rawResults];
    if (sortMode === "title") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortMode === "author") {
      list.sort((a, b) => getBookAuthors(a).localeCompare(getBookAuthors(b)));
    }
    return list;
  }, [rawResults, sortMode]);

  // Batch difficulty lookup for displayed books
  const allDisplayedIds = useMemo(() => {
    return processedResults.map((b) => b.id);
  }, [processedResults]);

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
  const totalCount = booksQuery.data?.count ?? 0;
  const hasNextPage = !!booksQuery.data?.next;
  const hasPrevPage = currentPage > 1;

  function handleSelectTopic(topicId: string) {
    if (selectedTopic === topicId) {
      setSelectedTopic(null);
    } else {
      setSelectedTopic(topicId);
    }
    setCurrentPage(1);
  }

  function handleBrowseAuthor(authorName: string) {
    setSelectedTopic(null);
    setSearchQuery(authorName);
    setDebouncedQuery(authorName);
    setCurrentPage(1);
  }

  function handleContinueBookClick(progressItem: ProgressItem) {
    const resolved = resolvedContinueBooksQuery.data?.[progressItem.gutenberg_book_id];
    if (resolved) {
      onSelectBook(resolved);
    } else {
      // Fallback synthetic book object if API lookup hasn't returned yet
      const fallbackBook: GutendexBook = {
        id: progressItem.gutenberg_book_id,
        title: progressItem.book_title || "Classic Book",
        authors: [{ name: "Author", birth_year: null, death_year: null }],
        subjects: [],
        languages: ["en"],
        download_count: 0,
        formats: {
          "text/plain; charset=utf-8": `https://www.gutenberg.org/cache/epub/${progressItem.gutenberg_book_id}/pg${progressItem.gutenberg_book_id}.txt`,
        },
      };
      onSelectBook(fallbackBook);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
      {/* Header */}
      <div>
        <p className="label-mono text-[var(--color-gold)]">Reading Room</p>
        <h1 className="text-3xl md:text-4xl font-bold mt-1">Public-Domain Digital Library</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
          Browse and read classic English literature from Project Gutenberg, with AI-powered
          vocabulary support, comprehension checks, genre discovery, and instant card generation.
        </p>
      </div>

      {/* CONTINUE READING SHELF */}
      {(continueReadingQuery.data ?? []).length > 0 && (
        <section aria-label="Continue reading shelf" className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-amber-400" />
            <h2 className="text-lg font-bold text-white">Continue Reading</h2>
            <span className="text-xs text-neutral-400 font-mono">
              ({continueReadingQuery.data?.length} book{continueReadingQuery.data?.length !== 1 ? "s" : ""})
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {continueReadingQuery.data?.map((item) => {
              const percent = item.total_chunks > 0
                ? Math.round(((item.current_chunk_index + 1) / item.total_chunks) * 100)
                : 0;
              const resolvedBook = resolvedContinueBooksQuery.data?.[item.gutenberg_book_id];
              const cover = resolvedBook ? getBookCover(resolvedBook) : null;
              const author = resolvedBook ? getBookAuthors(resolvedBook) : "Project Gutenberg Classic";

              return (
                <button
                  key={item.id}
                  onClick={() => handleContinueBookClick(item)}
                  className="glass-panel-soft p-3.5 rounded-2xl flex items-center gap-4 text-left hover:border-amber-500/50 hover:bg-white/[0.04] transition duration-200 cursor-pointer group relative overflow-hidden"
                >
                  {/* Cover */}
                  <div className="w-14 aspect-[2/3] bg-black/40 rounded-lg overflow-hidden shrink-0 border border-white/10 shadow relative">
                    {cover ? (
                      <img src={cover} alt={item.book_title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-neutral-900">
                        <BookOpen size={18} className="text-amber-500/50" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-sm font-semibold text-white truncate group-hover:text-amber-300 transition-colors">
                      {item.book_title}
                    </p>
                    <p className="text-xs text-neutral-400 truncate">{author}</p>

                    {/* Progress bar */}
                    <div className="space-y-1 pt-1">
                      <div className="flex items-center justify-between text-[10px] font-mono text-amber-300">
                        <span>Page {item.current_chunk_index + 1} of {item.total_chunks || 1}</span>
                        <span>{percent}%</span>
                      </div>
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-300"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* GENRE / SUBJECT BROWSING TILES */}
      <section aria-label="Browse by category" className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-[var(--color-gold)]" />
            <h2 className="text-lg font-bold text-white">Explore Genres & Topics</h2>
          </div>
          {selectedTopic && (
            <button
              onClick={() => setSelectedTopic(null)}
              className="text-xs text-amber-400 hover:text-amber-300 transition flex items-center gap-1"
            >
              <X size={12} /> Clear topic filter
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
          {TOPIC_CATEGORIES.map((cat) => {
            const active = selectedTopic === cat.queryTopic;
            return (
              <button
                key={cat.id}
                onClick={() => handleSelectTopic(cat.queryTopic)}
                className={`p-3 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex items-center gap-3 relative overflow-hidden ${
                  active
                    ? "border-amber-400 bg-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.25)] text-white scale-[1.02]"
                    : "border-white/10 bg-black/40 hover:border-white/25 hover:bg-white/5 text-neutral-300 hover:text-white"
                }`}
              >
                <span className="text-xl shrink-0">{cat.icon}</span>
                <span className="text-xs font-semibold truncate">{cat.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* SEARCH BAR & FILTERS */}
      <div className="space-y-4 bg-black/40 p-4 rounded-3xl border border-white/10 backdrop-blur-md">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          {/* Search input */}
          <div className="relative flex-1">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
            />
            <input
              id="reading-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search books by title, author, or keyword…"
              className="w-full bg-black/50 border border-white/15 rounded-2xl pl-12 pr-10 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40 transition-all text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setDebouncedQuery("");
                  setCurrentPage(1);
                }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white transition-colors p-1"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Sort selection */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-neutral-400 font-mono hidden sm:inline">Sort:</span>
            <div className="flex p-1 bg-black/60 rounded-xl border border-white/10">
              {(
                [
                  ["popular", "Popular"],
                  ["title", "Title (A-Z)"],
                  ["author", "Author"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    sortMode === mode
                      ? "bg-amber-500/25 border border-amber-400/40 text-amber-300 font-bold"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* CEFR Level Filter Pills */}
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-white/5">
          <span className="label-mono text-neutral-400 text-xs">CEFR Level:</span>
          <button
            onClick={() => {
              setSelectedLevel(null);
              setCurrentPage(1);
            }}
            className={`px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
              selectedLevel === null
                ? "bg-white/20 border border-white/40 text-white"
                : "border border-white/10 text-neutral-400 hover:text-white"
            }`}
          >
            All
          </button>
          {CEFR_LEVELS.map((lvl) => {
            const active = selectedLevel === lvl;
            return (
              <button
                key={lvl}
                onClick={() => {
                  setSelectedLevel(lvl);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1 rounded-full border text-xs font-bold transition-all cursor-pointer ${
                  active
                    ? "border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)] scale-105"
                    : "border-white/10 text-neutral-400 hover:border-white/30 hover:text-white"
                }`}
              >
                {lvl}
              </button>
            );
          })}
        </div>
      </div>

      {/* RESULTS SECTION */}
      <section aria-label="Book results">
        {/* Results bar header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">
              {isSearching
                ? `Results for "${debouncedQuery}"`
                : selectedTopic
                  ? `Topic: ${TOPIC_CATEGORIES.find((c) => c.queryTopic === selectedTopic)?.label ?? selectedTopic}`
                  : `Suggested Books for ${selectedLevel || userLevel || "B1"}`}
            </h2>
            {booksQuery.isLoading && (
              <Loader2 size={16} className="animate-spin text-amber-400" />
            )}
          </div>

          {totalCount > 0 && (
            <p className="text-xs text-neutral-400 font-mono">
              {totalCount.toLocaleString()} books available
            </p>
          )}
        </div>

        {/* Loading state */}
        {booksQuery.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
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

        {/* Error state */}
        {booksQuery.isError && (
          <div className="glass-panel border-red-500/30 p-8 rounded-3xl text-center space-y-4 my-6">
            <AlertCircle size={32} className="text-red-400 mx-auto" />
            <div className="space-y-1">
              <p className="text-red-300 font-bold text-base">Could not fetch books from Gutendex</p>
              <p className="text-xs text-neutral-400 max-w-md mx-auto">
                Project Gutenberg or Gutendex service may be experiencing high traffic.
              </p>
            </div>
            <button
              onClick={() => void booksQuery.refetch()}
              className="btn-crimson px-5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg"
            >
              <RotateCcw size={14} /> Retry Search
            </button>
          </div>
        )}

        {/* Empty search results */}
        {!booksQuery.isLoading && !booksQuery.isError && processedResults.length === 0 && (
          <div className="glass-panel-soft p-12 text-center space-y-3 rounded-3xl my-6">
            <BookOpen size={36} className="text-neutral-500 mx-auto" />
            <p className="text-base font-semibold text-white">
              {isSearching ? `No books found matching "${debouncedQuery}"` : "No books found"}
            </p>
            <p className="text-xs text-neutral-400 max-w-sm mx-auto">
              Try searching for a different keyword or author name, or click one of the genre tiles above.
            </p>
          </div>
        )}

        {/* Book Grid */}
        {!booksQuery.isLoading && !booksQuery.isError && processedResults.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {processedResults.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onClick={(b) => setPreviewBook(b)}
                onAuthorClick={(author) => handleBrowseAuthor(author)}
                estimatedLevel={levelMap[book.id] ?? (selectedLevel || undefined)}
              />
            ))}
          </div>
        )}

        {/* Pagination Bar */}
        {!booksQuery.isLoading && (hasPrevPage || hasNextPage) && (
          <div className="flex items-center justify-between pt-6 border-t border-white/10 mt-6">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={!hasPrevPage}
              className="px-4 py-2 rounded-xl border border-white/15 text-xs font-semibold text-neutral-300 hover:text-white hover:bg-white/5 transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
            >
              <ChevronLeft size={16} /> Previous Page
            </button>

            <span className="text-xs font-mono text-amber-300">
              Page {currentPage}
            </span>

            <button
              onClick={() => setCurrentPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="px-4 py-2 rounded-xl border border-white/15 text-xs font-semibold text-neutral-300 hover:text-white hover:bg-white/5 transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
            >
              Next Page <ChevronRight size={16} />
            </button>
          </div>
        )}
      </section>

      {/* Book Preview Modal */}
      {previewBook && (
        <BookPreviewModal
          book={previewBook}
          onClose={() => setPreviewBook(null)}
          onStartReading={(b) => {
            setPreviewBook(null);
            onSelectBook(b);
          }}
          onAuthorClick={(author) => handleBrowseAuthor(author)}
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

// Chunked non-blocking async pagination pass to prevent thread hanging on large books
async function paginateTextIntoPagesAsync(
  fullText: string,
  targetWordsPerPage: number = 180,
  onProgress?: (progressMsg: string) => void
): Promise<string[]> {
  let text = fullText;

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
  const BATCH_SIZE = 120;

  for (let i = 0; i < rawParagraphs.length; i++) {
    const para = rawParagraphs[i];
    const paraWords = para.split(/\s+/).length;

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

    if (i > 0 && i % BATCH_SIZE === 0) {
      if (onProgress) {
        const pct = Math.round((i / rawParagraphs.length) * 100);
        onProgress(`Paginating layout (${pct}%)…`);
      }
      await new Promise((r) => setTimeout(r, 0));
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

  const [loadingStage, setLoadingStage] = useState<"fetching" | "paginating" | "ready" | "error">("fetching");
  const [loadingMessage, setLoadingMessage] = useState<string>("Fetching book from Project Gutenberg…");
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
        const { data } = await supabase
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

      await supabase.from("reading_preferences").upsert(
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
      const { data, error } = await supabase
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
        await supabase.from("reading_bookmarks").delete().eq("id", existing.id);
        setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));
        toast.success("Bookmark removed");
      } else {
        const pageText = pages[pageIndex] ?? "";
        const snippet = pageText.slice(0, 45).replace(/\n/g, " ").trim();
        const label = snippet ? `"${snippet}…"` : `Page ${pageIndex + 1}`;

        const { data, error } = await supabase
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
      await supabase.from("reading_bookmarks").delete().eq("id", bookmarkId);
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
  async function loadProgress(): Promise<number> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return 0;

      const { data, error } = await supabase
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

      await supabase.from("reading_progress").upsert(
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

      // Invalidate continue reading shelf query so home shelf updates instantly
      qc.invalidateQueries({ queryKey: ["reading-progress-shelf"] });
    } catch {
      // Ignore error
    }
  }

  // Main book text load & pagination function
  const loadBookContent = useCallback(async () => {
    if (!textUrl) {
      setLoadError("No readable plain-text format found for this book.");
      setLoadingStage("error");
      return;
    }

    const targetWords = computeTargetWordsPerPage(fontSizeStep, lineSpacing, isMobile);

    // 1. Check in-memory cache
    const cached = bookTextCache.get(book.id);
    if (cached && cached.rawText && cached.targetWords === targetWords && cached.pages.length > 0) {
      setRawFullText(cached.rawText);
      setPages(cached.pages);
      setLoadingStage("ready");
      const savedIdx = await loadProgress();
      setPageIndex(Math.min(savedIdx, Math.max(0, cached.pages.length - 1)));
      return;
    }

    setLoadingStage("fetching");
    setLoadingMessage("Fetching full text from Project Gutenberg…");
    setLoadError(null);

    try {
      let fullText = cached?.rawText || "";

      if (!fullText) {
        const result = await fetchTextFn({ data: { bookId: book.id, textUrl } });
        fullText = result.chunks.join("\n\n");
      }

      setRawFullText(fullText);

      setLoadingStage("paginating");
      setLoadingMessage("Paginating text layout…");

      const bookPages = await paginateTextIntoPagesAsync(
        fullText,
        targetWords,
        (msg) => setLoadingMessage(msg)
      );

      if (!bookPages || bookPages.length === 0) {
        throw new Error("No readable chapters or paragraphs found in this text.");
      }

      // Save to cache
      bookTextCache.set(book.id, {
        bookId: book.id,
        rawText: fullText,
        targetWords,
        pages: bookPages,
      });

      setPages(bookPages);
      setLoadingStage("ready");

      const savedIdx = await loadProgress();
      setPageIndex(Math.min(savedIdx, Math.max(0, bookPages.length - 1)));
    } catch (e) {
      setLoadError((e as Error).message || "Failed to download book text.");
      setLoadingStage("error");
    }
  }, [book.id, textUrl, fontSizeStep, lineSpacing, isMobile]);

  useEffect(() => {
    void loadBookContent();
  }, [loadBookContent]);

  // Dynamic re-pagination on typography/screen resize
  const prevSettingsRef = useRef({ fontSizeStep, lineSpacing, isMobile });
  useEffect(() => {
    if (!rawFullText || loadingStage !== "ready") return;
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

    void (async () => {
      setLoadingStage("paginating");
      setLoadingMessage("Re-paginating layout for typography changes…");
      const newPages = await paginateTextIntoPagesAsync(rawFullText, targetWords);
      if (pages.length > 0) {
        const ratio = pageIndex / Math.max(1, pages.length);
        const newIdx = Math.min(newPages.length - 1, Math.max(0, Math.floor(ratio * newPages.length)));
        setPageIndex(newIdx);
      }
      setPages(newPages);
      bookTextCache.set(book.id, {
        bookId: book.id,
        rawText: rawFullText,
        targetWords,
        pages: newPages,
      });
      setLoadingStage("ready");
    })();
  }, [rawFullText, fontSizeStep, lineSpacing, isMobile, pages.length, pageIndex, loadingStage, book.id]);

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

  // SpeechSynthesis read-aloud
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

  // Loading indicator overlay (fetching or paginating pass)
  if (loadingStage === "fetching" || loadingStage === "paginating") {
    return (
      <div className="max-w-xl mx-auto py-20 text-center space-y-6 glass-panel border-amber-500/20 p-8 rounded-3xl animate-in fade-in duration-300">
        <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-amber-500/20 border-t-amber-400 animate-spin" />
          <BookOpen size={28} className="text-amber-400 animate-pulse" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-white">{book.title}</h3>
          <p className="text-xs text-amber-300 font-mono flex items-center justify-center gap-2">
            <Loader2 size={12} className="animate-spin" />
            {loadingMessage}
          </p>
        </div>
        <p className="text-[11px] text-neutral-400 max-w-sm mx-auto">
          Downloading full public-domain text and computing precise pagination layout…
        </p>
      </div>
    );
  }

  // Graceful error state with Retry button
  if (loadingStage === "error" || loadError) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-5 glass-panel border-red-500/30 p-8 rounded-3xl animate-in fade-in duration-300">
        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
          <AlertCircle size={28} />
        </div>
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-white">Could Not Load Book</h3>
          <p className="text-sm text-neutral-300 max-w-md mx-auto">{loadError || "An error occurred while fetching book text."}</p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => void loadBookContent()}
            className="btn-crimson px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-lg"
          >
            <RotateCcw size={14} /> Retry Loading
          </button>
          <button
            onClick={onBack}
            className="px-5 py-2.5 rounded-xl text-xs font-medium border border-white/15 text-neutral-300 hover:text-white hover:bg-white/5 transition cursor-pointer"
          >
            Back to Library
          </button>
        </div>
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
              className="flex items-center gap-1 text-neutral-300 hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/10 cursor-pointer"
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
              className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border cursor-pointer ${
                searchOpen
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-white/5 border-white/10 text-neutral-300 hover:text-white hover:bg-white/10"
              }`}
              title="Search in this book"
            >
              <Search size={14} />
              <span className="hidden sm:inline">Search</span>
            </button>

            {/* Table of Contents */}
            {tocItems.length > 0 && (
              <button
                id="reading-toc-btn"
                onClick={() => {
                  setTocOpen(!tocOpen);
                  setSettingsOpen(false);
                  setBookmarksOpen(false);
                  setSearchOpen(false);
                }}
                className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border cursor-pointer ${
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
              className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border cursor-pointer ${
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
              className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border cursor-pointer ${
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
                  className="px-2 py-1 rounded text-neutral-300 hover:text-white hover:bg-white/10 flex items-center gap-1 transition cursor-pointer"
                  title="Read page aloud"
                >
                  <Volume2 size={14} className="text-amber-400" />
                  <span className="hidden md:inline">Read aloud</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={togglePauseReadAloud}
                    className="px-2 py-1 rounded text-amber-300 hover:bg-white/10 flex items-center gap-1 transition cursor-pointer"
                    title={isSpeakingPaused ? "Resume speech" : "Pause speech"}
                  >
                    {isSpeakingPaused ? <Play size={14} /> : <Pause size={14} />}
                    <span className="hidden md:inline">{isSpeakingPaused ? "Resume" : "Pause"}</span>
                  </button>
                  <button
                    onClick={stopReadAloud}
                    className="px-2 py-1 rounded text-red-400 hover:bg-white/10 flex items-center gap-1 transition cursor-pointer"
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
              className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-neutral-300 hover:text-white hover:bg-white/10 transition text-xs flex items-center gap-1.5 cursor-pointer"
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
              className={`px-2.5 py-1 rounded-lg transition text-xs flex items-center gap-1.5 border cursor-pointer ${
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
              className="text-neutral-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
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
                  className={`py-1.5 px-3 rounded-xl border text-xs font-semibold transition cursor-pointer ${
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
                  className={`py-1.5 px-3 rounded-xl border text-xs font-medium capitalize transition cursor-pointer ${
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
                    className={`p-2 rounded-xl border text-xs flex items-center gap-2 transition cursor-pointer ${
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
                  className={`py-1.5 px-2 rounded-xl border text-xs font-semibold transition cursor-pointer ${
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
              className="text-neutral-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
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
                      className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs rounded-lg transition font-medium cursor-pointer"
                    >
                      Jump →
                    </button>
                    <button
                      onClick={() => void handleDeleteBookmark(bm.id)}
                      className="p-1 text-neutral-400 hover:text-red-400 transition rounded-lg cursor-pointer"
                      title="Delete bookmark"
                    >
                      <X size={14} />
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
              className="text-neutral-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
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
                className="w-full flex items-center justify-between p-2 rounded-xl bg-white/5 hover:bg-white/10 text-left transition group border border-transparent hover:border-white/10 cursor-pointer"
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
              className="text-neutral-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
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
                className="absolute right-3 top-2.5 text-neutral-400 hover:text-white text-xs cursor-pointer"
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
                className="w-full text-left p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition flex flex-col gap-1 group cursor-pointer"
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
              Page {displayProgressPage} of {totalPages} ({Math.round((displayProgressPage / Math.max(1, totalPages)) * 100)}%)
            </span>
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--color-crimson)] via-[var(--color-gold)] to-emerald-400 transition-all duration-500"
              style={{ width: `${(displayProgressPage / Math.max(1, totalPages)) * 100}%` }}
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
              className="text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
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
                className="btn-crimson rounded-xl px-4 py-2.5 text-sm w-full mt-2 font-medium cursor-pointer"
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
                  className="hover:opacity-100 opacity-60 flex items-center gap-1 transition disabled:opacity-20 font-medium cursor-pointer"
                >
                  <ChevronLeft size={14} /> Previous
                </button>

                <span className={`${currentFont.cssClass} text-xs tracking-wider opacity-80 font-serif font-semibold`}>
                  — {leftPageIndex + 1} —
                </span>

                {!effectiveTwoPageMode ? (
                  <button
                    id="reading-next-btn"
                    onClick={() => triggerPageTurn("next")}
                    disabled={!hasNextPage}
                    className="hover:opacity-100 opacity-90 font-medium flex items-center gap-1 transition text-amber-600 dark:text-amber-400 disabled:opacity-20 cursor-pointer"
                  >
                    Next <ChevronRight size={14} />
                  </button>
                ) : (
                  <span className="text-[10px] opacity-40 font-mono">
                    {Math.round(((leftPageIndex + 1) / Math.max(1, totalPages)) * 100)}%
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
                    className="hover:opacity-100 opacity-90 font-medium flex items-center gap-1 transition text-amber-600 dark:text-amber-400 disabled:opacity-20 cursor-pointer"
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
            className="text-neutral-400 hover:text-white disabled:opacity-30 p-1 flex items-center gap-0.5 transition cursor-pointer"
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
            className="text-neutral-400 hover:text-white disabled:opacity-30 p-1 flex items-center gap-0.5 transition cursor-pointer"
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
// Comprehension quiz item
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
              className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition cursor-pointer ${
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
          className="text-neutral-500 hover:text-white transition-colors cursor-pointer"
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
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
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

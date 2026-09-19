export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cards: {
        Row: {
          card_state: string
          cloze: string | null
          created_at: string
          definition: string | null
          due_at: string
          ease_factor: number
          examples: string | null
          exported: boolean
          french: string | null
          fsrs_difficulty: number | null
          fsrs_last_review: string | null
          fsrs_stability: number | null
          fsrs_state: string | null
          fsrs_step: number | null
          grammar: string | null
          id: string
          interval_days: number
          ipa: string | null
          last_grammar_drill_at: string | null
          last_reviewed_at: string | null
          learning_step: number
          level: string | null
          needs_review: boolean
          pos: string | null
          repetitions: number
          speaking_a1: string | null
          speaking_a2: string | null
          speaking_q1: string | null
          speaking_q2: string | null
          tags: string[]
          user_id: string
          word: string
        }
        Insert: {
          card_state?: string
          cloze?: string | null
          created_at?: string
          definition?: string | null
          due_at?: string
          ease_factor?: number
          examples?: string | null
          exported?: boolean
          french?: string | null
          fsrs_difficulty?: number | null
          fsrs_last_review?: string | null
          fsrs_stability?: number | null
          fsrs_state?: string | null
          fsrs_step?: number | null
          grammar?: string | null
          id?: string
          interval_days?: number
          ipa?: string | null
          last_grammar_drill_at?: string | null
          last_reviewed_at?: string | null
          learning_step?: number
          level?: string | null
          needs_review?: boolean
          pos?: string | null
          repetitions?: number
          speaking_a1?: string | null
          speaking_a2?: string | null
          speaking_q1?: string | null
          speaking_q2?: string | null
          tags?: string[]
          user_id: string
          word: string
        }
        Update: {
          card_state?: string
          cloze?: string | null
          created_at?: string
          definition?: string | null
          due_at?: string
          ease_factor?: number
          examples?: string | null
          exported?: boolean
          french?: string | null
          fsrs_difficulty?: number | null
          fsrs_last_review?: string | null
          fsrs_stability?: number | null
          fsrs_state?: string | null
          fsrs_step?: number | null
          grammar?: string | null
          id?: string
          interval_days?: number
          ipa?: string | null
          last_grammar_drill_at?: string | null
          last_reviewed_at?: string | null
          learning_step?: number
          level?: string | null
          needs_review?: boolean
          pos?: string | null
          repetitions?: number
          speaking_a1?: string | null
          speaking_a2?: string | null
          speaking_q1?: string | null
          speaking_q2?: string | null
          tags?: string[]
          user_id?: string
          word?: string
        }
        Relationships: []
      }
      content_sources: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          platform: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          platform?: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          platform?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_goals: {
        Row: {
          created_at: string
          date: string
          id: string
          target_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          target_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          target_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fluency_recordings: {
        Row: {
          confidence_rating: number | null
          comprehension_score: string | null
          created_at: string
          duration_seconds: number
          exercise_type: string
          fluency_rating: number | null
          hesitation_rating: number | null
          id: string
          pinned: boolean
          prompt_text: string
          session_id: string | null
          storage_path: string | null
          user_id: string
          week_theme: string
        }
        Insert: {
          confidence_rating?: number | null
          comprehension_score?: string | null
          created_at?: string
          duration_seconds?: number
          exercise_type: string
          fluency_rating?: number | null
          hesitation_rating?: number | null
          id?: string
          pinned?: boolean
          prompt_text?: string
          session_id?: string | null
          storage_path?: string | null
          user_id: string
          week_theme?: string
        }
        Update: {
          confidence_rating?: number | null
          comprehension_score?: string | null
          created_at?: string
          duration_seconds?: number
          exercise_type?: string
          fluency_rating?: number | null
          hesitation_rating?: number | null
          id?: string
          pinned?: boolean
          prompt_text?: string
          session_id?: string | null
          storage_path?: string | null
          user_id?: string
          week_theme?: string
        }
        Relationships: [
          {
            foreignKeyName: "fluency_recordings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "fluency_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      fluency_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          journey_cell_id: string | null
          session_length: string
          source_video_id: string | null
          user_id: string
          week_theme: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          journey_cell_id?: string | null
          session_length: string
          source_video_id?: string | null
          user_id: string
          week_theme?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          journey_cell_id?: string | null
          session_length?: string
          source_video_id?: string | null
          user_id?: string
          week_theme?: string
        }
        Relationships: [
          {
            foreignKeyName: "fluency_sessions_journey_cell_id_fkey"
            columns: ["journey_cell_id"]
            isOneToOne: false
            referencedRelation: "journey_cells"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fluency_sessions_source_video_id_fkey"
            columns: ["source_video_id"]
            isOneToOne: false
            referencedRelation: "shadowing_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      grammar_error_patterns: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          occurrences: number
          pattern_tag: string
          resolved: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          occurrences?: number
          pattern_tag: string
          resolved?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          occurrences?: number
          pattern_tag?: string
          resolved?: boolean
          user_id?: string
        }
        Relationships: []
      }
      journey_cells: {
        Row: {
          complexity_level: number
          created_at: string
          id: string
          sessions_completed: number
          situation: Database["public"]["Enums"]["journey_situation"]
          status: Database["public"]["Enums"]["journey_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          complexity_level: number
          created_at?: string
          id?: string
          sessions_completed?: number
          situation: Database["public"]["Enums"]["journey_situation"]
          status?: Database["public"]["Enums"]["journey_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          complexity_level?: number
          created_at?: string
          id?: string
          sessions_completed?: number
          situation?: Database["public"]["Enums"]["journey_situation"]
          status?: Database["public"]["Enums"]["journey_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      learner_profile: {
        Row: {
          created_at: string
          current_level: Database["public"]["Enums"]["cefr_level"]
          id: string
          level_updated_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_level?: Database["public"]["Enums"]["cefr_level"]
          id?: string
          level_updated_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_level?: Database["public"]["Enums"]["cefr_level"]
          id?: string
          level_updated_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      learner_weak_points: {
        Row: {
          created_at: string
          example: string
          id: string
          last_seen_at: string
          occurrences: number
          resolved: boolean
          tag: string
          user_id: string
        }
        Insert: {
          created_at?: string
          example?: string
          id?: string
          last_seen_at?: string
          occurrences?: number
          resolved?: boolean
          tag: string
          user_id: string
        }
        Update: {
          created_at?: string
          example?: string
          id?: string
          last_seen_at?: string
          occurrences?: number
          resolved?: boolean
          tag?: string
          user_id?: string
        }
        Relationships: []
      }
      lessons: {
        Row: {
          card_id: string
          content: Json
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          card_id: string
          content: Json
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          card_id?: string
          content?: Json
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: true
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_progress: {
        Row: {
          book_title: string
          current_chunk_index: number
          gutenberg_book_id: number
          id: string
          total_chunks: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          book_title: string
          current_chunk_index?: number
          gutenberg_book_id: number
          id?: string
          total_chunks?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          book_title?: string
          current_chunk_index?: number
          gutenberg_book_id?: number
          id?: string
          total_chunks?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reading_preferences: {
        Row: {
          user_id: string
          font_size: string
          line_spacing: string
          theme: string
          read_aloud_rate: number
          updated_at: string
        }
        Insert: {
          user_id: string
          font_size?: string
          line_spacing?: string
          theme?: string
          read_aloud_rate?: number
          updated_at?: string
        }
        Update: {
          user_id?: string
          font_size?: string
          line_spacing?: string
          theme?: string
          read_aloud_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      reading_bookmarks: {
        Row: {
          id: string
          user_id: string
          gutenberg_book_id: number
          chunk_index: number
          label: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          gutenberg_book_id: number
          chunk_index: number
          label?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          gutenberg_book_id?: number
          chunk_index?: number
          label?: string
          created_at?: string
        }
        Relationships: []
      }
      pronunciation_progress: {
        Row: {
          id: string
          user_id: string
          category: string
          clear_count: number
          confusable_count: number
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          category: string
          clear_count?: number
          confusable_count?: number
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          category?: string
          clear_count?: number
          confusable_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      shadowing_notes: {
        Row: {
          card_id: string | null
          context: string | null
          created_at: string
          id: string
          user_id: string
          video_id: string
          word: string
        }
        Insert: {
          card_id?: string | null
          context?: string | null
          created_at?: string
          id?: string
          user_id: string
          video_id: string
          word: string
        }
        Update: {
          card_id?: string | null
          context?: string | null
          created_at?: string
          id?: string
          user_id?: string
          video_id?: string
          word?: string
        }
        Relationships: [
          {
            foreignKeyName: "shadowing_notes_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadowing_notes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "shadowing_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      shadowing_videos: {
        Row: {
          created_at: string
          duration_seconds: number | null
          id: string
          last_watched_at: string | null
          retell_skipped_count: number
          source_type: string
          source_url: string | null
          storage_path: string | null
          thumbnail_url: string | null
          title: string | null
          user_id: string
          watch_duration_seconds: number
          youtube_id: string | null
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          last_watched_at?: string | null
          retell_skipped_count?: number
          source_type: string
          source_url?: string | null
          storage_path?: string | null
          thumbnail_url?: string | null
          title?: string | null
          user_id: string
          watch_duration_seconds?: number
          youtube_id?: string | null
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          last_watched_at?: string | null
          retell_skipped_count?: number
          source_type?: string
          source_url?: string | null
          storage_path?: string | null
          thumbnail_url?: string | null
          title?: string | null
          user_id?: string
          watch_duration_seconds?: number
          youtube_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_journey_cells: { Args: { _user: string }; Returns: undefined }
      ensure_learner_profile: { Args: { _user: string }; Returns: undefined }
      recompute_journey_status: { Args: { _user: string }; Returns: undefined }
    }
    Enums: {
      cefr_level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2"
      journey_situation:
        | "social"
        | "transactional"
        | "professional"
        | "emotional"
        | "narrative"
      journey_status: "locked" | "available" | "in_progress" | "mastered"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cefr_level: ["A1", "A2", "B1", "B2", "C1", "C2"],
      journey_situation: [
        "social",
        "transactional",
        "professional",
        "emotional",
        "narrative",
      ],
      journey_status: ["locked", "available", "in_progress", "mastered"],
    },
  },
} as const

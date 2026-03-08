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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          currency: string
          exchange: string | null
          id: string
          metadata_json: Json | null
          name: string
          symbol: string
        }
        Insert: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          currency?: string
          exchange?: string | null
          id?: string
          metadata_json?: Json | null
          name: string
          symbol: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          currency?: string
          exchange?: string | null
          id?: string
          metadata_json?: Json | null
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      group_invites: {
        Row: {
          created_at: string
          group_id: string
          id: string
          invited_by_user_id: string
          invited_email: string | null
          invited_user_id: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["invite_status"]
          token: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          invited_by_user_id: string
          invited_email?: string | null
          invited_user_id?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          invited_by_user_id?: string
          invited_email?: string | null
          invited_user_id?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string
          group_id: string
          id: string
          role: Database["public"]["Enums"]["group_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          role?: Database["public"]["Enums"]["group_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          role?: Database["public"]["Enums"]["group_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
        }
        Relationships: []
      }
      holdings: {
        Row: {
          asset_id: string
          avg_cost: number
          cost_currency: string
          created_at: string
          id: string
          portfolio_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          asset_id: string
          avg_cost?: number
          cost_currency?: string
          created_at?: string
          id?: string
          portfolio_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          asset_id?: string
          avg_cost?: number
          cost_currency?: string
          created_at?: string
          id?: string
          portfolio_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "holdings_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_valuations: {
        Row: {
          as_of_date: string
          created_at: string
          currency: string
          id: string
          portfolio_id: string
          total_value: number
        }
        Insert: {
          as_of_date?: string
          created_at?: string
          currency?: string
          id?: string
          portfolio_id: string
          total_value?: number
        }
        Update: {
          as_of_date?: string
          created_at?: string
          currency?: string
          id?: string
          portfolio_id?: string
          total_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_valuations_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolios: {
        Row: {
          base_currency: string
          created_at: string
          description: string | null
          group_id: string | null
          id: string
          name: string
          owner_user_id: string
          public_slug: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["portfolio_visibility"]
        }
        Insert: {
          base_currency?: string
          created_at?: string
          description?: string | null
          group_id?: string | null
          id?: string
          name: string
          owner_user_id: string
          public_slug?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["portfolio_visibility"]
        }
        Update: {
          base_currency?: string
          created_at?: string
          description?: string | null
          group_id?: string | null
          id?: string
          name?: string
          owner_user_id?: string
          public_slug?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["portfolio_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "portfolios_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      prices: {
        Row: {
          as_of_date: string
          asset_id: string
          created_at: string
          currency: string
          id: string
          price: number
          source: string | null
        }
        Insert: {
          as_of_date?: string
          asset_id: string
          created_at?: string
          currency?: string
          id?: string
          price: number
          source?: string | null
        }
        Update: {
          as_of_date?: string
          asset_id?: string
          created_at?: string
          currency?: string
          id?: string
          price?: number
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prices_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          default_currency: string
          display_name: string | null
          id: string
          onboarding_completed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_portfolio: { Args: { _portfolio_id: string }; Returns: boolean }
      can_view_portfolio: { Args: { _portfolio_id: string }; Returns: boolean }
      import_holdings_snapshot: {
        Args: { _mode: string; _portfolio_id: string; _rows_json: Json }
        Returns: Json
      }
      get_leaderboard: {
        Args: { _period?: string }
        Returns: {
          end_value: number | null
          last_updated: string | null
          owner_name: string | null
          portfolio_id: string
          portfolio_name: string
          return_abs: number | null
          return_pct: number | null
          start_value: number | null
          visibility: Database["public"]["Enums"]["portfolio_visibility"]
        }[]
      }
      is_group_member: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_owner: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      log_audit_action: {
        Args: { _action: string; _details?: Json; _entity_id?: string; _entity_type?: string }
        Returns: undefined
      }
      owns_portfolio: { Args: { _portfolio_id: string }; Returns: boolean }
    }
    Enums: {
      asset_type: "stock" | "etf" | "fund" | "metal" | "other"
      group_role: "owner" | "member"
      invite_status: "pending" | "accepted" | "declined"
      portfolio_visibility: "private" | "authenticated" | "public" | "group"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      asset_type: ["stock", "etf", "fund", "metal", "other"],
      group_role: ["owner", "member"],
      invite_status: ["pending", "accepted", "declined"],
      portfolio_visibility: ["private", "authenticated", "public", "group"],
    },
  },
} as const

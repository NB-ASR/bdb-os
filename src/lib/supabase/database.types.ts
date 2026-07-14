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
      activity_items: {
        Row: {
          action: string
          actor_user_id: string | null
          detail: string
          id: string
          occurred_at: string
          tone: string
          workspace_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          detail: string
          id?: string
          occurred_at?: string
          tone?: string
          workspace_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          detail?: string
          id?: string
          occurred_at?: string
          tone?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: number
          metadata: Json
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          metadata?: Json
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          metadata?: Json
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          id: string
          last_run_at: string | null
          name: string
          trigger_description: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          name: string
          trigger_description: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          name?: string
          trigger_description?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          matched_invoice_id: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          transaction_date: string
          transaction_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          matched_invoice_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          transaction_date: string
          transaction_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          matched_invoice_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          transaction_date?: string
          transaction_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_workspace_id_matched_invoice_id_fkey"
            columns: ["workspace_id", "matched_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      bookings: {
        Row: {
          booking_date: string
          booking_time: string
          created_at: string
          customer_id: string
          duration_minutes: number
          id: string
          staff_name: string
          status: Database["public"]["Enums"]["booking_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          booking_date: string
          booking_time: string
          created_at?: string
          customer_id: string
          duration_minutes: number
          id?: string
          staff_name: string
          status?: Database["public"]["Enums"]["booking_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          booking_date?: string
          booking_time?: string
          created_at?: string
          customer_id?: string
          duration_minutes?: number
          id?: string
          staff_name?: string
          status?: Database["public"]["Enums"]["booking_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_workspace_id_customer_id_fkey"
            columns: ["workspace_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "bookings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          id: string
          minimum_ends_on: string | null
          minimum_term_months: number
          monthly_amount: number | null
          notes: string | null
          plan_id: string | null
          signed_at: string | null
          starts_on: string | null
          status: Database["public"]["Enums"]["contract_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          minimum_ends_on?: string | null
          minimum_term_months: number
          monthly_amount?: number | null
          notes?: string | null
          plan_id?: string | null
          signed_at?: string | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          minimum_ends_on?: string | null
          minimum_term_months?: number
          monthly_amount?: number | null
          notes?: string | null
          plan_id?: string | null
          signed_at?: string | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          code: string
          company: string
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address?: string | null
          code: string
          company?: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string | null
          code?: string
          company?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          customer_id: string | null
          document_type: string
          id: string
          linked_to: string
          name: string
          size_label: string
          storage_path: string | null
          uploaded_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          document_type: string
          id?: string
          linked_to: string
          name: string
          size_label: string
          storage_path?: string | null
          uploaded_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          document_type?: string
          id?: string
          linked_to?: string
          name?: string
          size_label?: string
          storage_path?: string | null
          uploaded_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_workspace_id_customer_id_fkey"
            columns: ["workspace_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          category: string
          created_at: string
          description: string
          is_active: boolean
          key: string
          name: string
          route: string | null
          sort_order: number
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          is_active?: boolean
          key: string
          name: string
          route?: string | null
          sort_order?: number
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          is_active?: boolean
          key?: string
          name?: string
          route?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["membership_role"]
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["membership_role"]
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["membership_role"]
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          created_at: string
          customer_id: string
          description: string
          due_at: string
          id: string
          issued_at: string
          number: string
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id: string
          description: string
          due_at: string
          id?: string
          issued_at?: string
          number: string
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string
          description?: string
          due_at?: string
          id?: string
          issued_at?: string
          number?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_workspace_id_customer_id_fkey"
            columns: ["workspace_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          channel: string
          created_at: string
          customer_id: string
          id: string
          occurred_at: string
          preview: string
          status: Database["public"]["Enums"]["message_status"]
          subject: string
          unread: boolean
          updated_at: string
          workspace_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          customer_id: string
          id?: string
          occurred_at?: string
          preview: string
          status?: Database["public"]["Enums"]["message_status"]
          subject: string
          unread?: boolean
          updated_at?: string
          workspace_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          customer_id?: string
          id?: string
          occurred_at?: string
          preview?: string
          status?: Database["public"]["Enums"]["message_status"]
          subject?: string
          unread?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_workspace_id_customer_id_fkey"
            columns: ["workspace_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_features: {
        Row: {
          created_at: string
          enabled: boolean
          feature_key: string
          plan_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          feature_key: string
          plan_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          feature_key?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_features_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "plan_features_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          name: string
          pricing_model: string
          sort_order: number
          term_options: number[]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
          name: string
          pricing_model?: string
          sort_order?: number
          term_options?: number[]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          name?: string
          pricing_model?: string
          sort_order?: number
          term_options?: number[]
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          role?: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at: string | null
          contract_id: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          plan_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cancel_at?: string | null
          contract_id?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          plan_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cancel_at?: string | null
          contract_id?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          plan_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_feature_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          ends_at: string | null
          feature_key: string
          reason: string | null
          starts_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled: boolean
          ends_at?: string | null
          feature_key: string
          reason?: string | null
          starts_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          ends_at?: string | null
          feature_key?: string
          reason?: string | null
          starts_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_feature_overrides_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "workspace_feature_overrides_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_memberships: {
        Row: {
          created_at: string
          invited_by: string | null
          joined_at: string | null
          role: Database["public"]["Enums"]["membership_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          created_at: string
          currency: string
          email: string | null
          invoice_prefix: string
          owner_name: string
          phone: string | null
          updated_at: string
          vat_rate: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          email?: string | null
          invoice_prefix?: string
          owner_name?: string
          phone?: string | null
          updated_at?: string
          vat_rate?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          email?: string | null
          invoice_prefix?: string
          owner_name?: string
          phone?: string | null
          updated_at?: string
          vat_rate?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_themes: {
        Row: {
          accent_color: string
          client_logo_path: string | null
          created_at: string
          density: string
          font_family: string
          high_contrast: boolean
          mode: string
          preset: string
          reduced_motion: boolean
          text_scale: number
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          accent_color?: string
          client_logo_path?: string | null
          created_at?: string
          density?: string
          font_family?: string
          high_contrast?: boolean
          mode?: string
          preset?: string
          reduced_motion?: boolean
          text_scale?: number
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          accent_color?: string
          client_logo_path?: string | null
          created_at?: string
          density?: string
          font_family?: string
          high_contrast?: boolean
          mode?: string
          preset?: string
          reduced_motion?: boolean
          text_scale?: number
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_themes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          legal_name: string | null
          name: string
          plan_id: string | null
          slug: string
          status: Database["public"]["Enums"]["workspace_status"]
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          legal_name?: string | null
          name: string
          plan_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["workspace_status"]
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          legal_name?: string | null
          name?: string
          plan_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["workspace_status"]
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_workspace: {
        Args: { workspace_name: string; workspace_slug: string }
        Returns: string
      }
      get_effective_features: {
        Args: { target_workspace_id: string }
        Returns: {
          enabled: boolean
          feature_key: string
          source: string
        }[]
      }
      get_my_workspace_context: { Args: never; Returns: Json }
    }
    Enums: {
      booking_status: "confirmed" | "pending" | "completed"
      contract_status:
        | "draft"
        | "sent"
        | "accepted"
        | "active"
        | "completed"
        | "cancelled"
      invoice_status: "draft" | "sent" | "paid" | "overdue"
      membership_role: "owner" | "admin" | "manager" | "staff" | "viewer"
      membership_status: "invited" | "active" | "suspended"
      message_status: "open" | "replied" | "approval"
      platform_role: "founder" | "support"
      subscription_status:
        | "incomplete"
        | "trialing"
        | "active"
        | "past_due"
        | "paused"
        | "cancelled"
      transaction_status: "matched" | "unmatched" | "review"
      workspace_status: "trial" | "active" | "suspended" | "cancelled"
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
      booking_status: ["confirmed", "pending", "completed"],
      contract_status: [
        "draft",
        "sent",
        "accepted",
        "active",
        "completed",
        "cancelled",
      ],
      invoice_status: ["draft", "sent", "paid", "overdue"],
      membership_role: ["owner", "admin", "manager", "staff", "viewer"],
      membership_status: ["invited", "active", "suspended"],
      message_status: ["open", "replied", "approval"],
      platform_role: ["founder", "support"],
      subscription_status: [
        "incomplete",
        "trialing",
        "active",
        "past_due",
        "paused",
        "cancelled",
      ],
      transaction_status: ["matched", "unmatched", "review"],
      workspace_status: ["trial", "active", "suspended", "cancelled"],
    },
  },
} as const

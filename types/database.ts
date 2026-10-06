// Generated from the FSMB migrations (01–19). Regenerate with `npm run db:types`.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      activity_log: {
        Row: {
          id: number
          ts: string
          log_date: string | null
          scope: Database["public"]["Enums"]["log_scope"]
          action: Database["public"]["Enums"]["log_action"]
          subject_user_id: string | null
          subject_name: string | null
          actor_user_id: string | null
          project_id: string | null
          project_code: string | null
          task_id: string | null
          task_code: string | null
          details: string | null
          reason_code: Database["public"]["Enums"]["breach_reason"] | null
          source: string
        }
        Insert: {
          id?: never
          ts?: string
          log_date?: never
          scope: Database["public"]["Enums"]["log_scope"]
          action: Database["public"]["Enums"]["log_action"]
          subject_user_id?: string | null
          subject_name?: string | null
          actor_user_id?: string | null
          project_id?: string | null
          project_code?: string | null
          task_id?: string | null
          task_code?: string | null
          details?: string | null
          reason_code?: Database["public"]["Enums"]["breach_reason"] | null
          source?: string
        }
        Update: {
          id?: never
          ts?: string
          log_date?: never
          scope?: Database["public"]["Enums"]["log_scope"]
          action?: Database["public"]["Enums"]["log_action"]
          subject_user_id?: string | null
          subject_name?: string | null
          actor_user_id?: string | null
          project_id?: string | null
          project_code?: string | null
          task_id?: string | null
          task_code?: string | null
          details?: string | null
          reason_code?: Database["public"]["Enums"]["breach_reason"] | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          }
        ]
      }
      daily_report_attachments: {
        Row: {
          id: string
          report_id: string
          storage_path: string
          file_name: string
          mime_type: string
          size_bytes: number
          uploaded_by: string
          uploaded_at: string
        }
        Insert: {
          id?: string
          report_id: string
          storage_path: string
          file_name: string
          mime_type: string
          size_bytes: number
          uploaded_by?: string
          uploaded_at?: string
        }
        Update: {
          id?: string
          report_id?: string
          storage_path?: string
          file_name?: string
          mime_type?: string
          size_bytes?: number
          uploaded_by?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_attachments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      daily_report_items: {
        Row: {
          id: string
          report_id: string
          task_id: string
          parent_task_id: string | null
          task_code: string
          task_title: string
          progress_after: number | null
          status_after: Database["public"]["Enums"]["task_status"] | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          report_id: string
          task_id: string
          parent_task_id?: string | null
          task_code: string
          task_title: string
          progress_after?: number | null
          status_after?: Database["public"]["Enums"]["task_status"] | null
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          report_id?: string
          task_id?: string
          parent_task_id?: string | null
          task_code?: string
          task_title?: string
          progress_after?: number | null
          status_after?: Database["public"]["Enums"]["task_status"] | null
          note?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_items_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          }
        ]
      }
      daily_reports: {
        Row: {
          id: string
          user_id: string
          project_id: string
          report_date: string
          day_name: string
          update_text: string
          issues: string | null
          next_task_id: string | null
          next_task_text: string | null
          remarks: string | null
          locked: boolean
          submitted_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          project_id: string
          report_date: string
          day_name: string
          update_text: string
          issues?: string | null
          next_task_id?: string | null
          next_task_text?: string | null
          remarks?: string | null
          locked?: boolean
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_id?: string
          report_date?: string
          day_name?: string
          update_text?: string
          issues?: string | null
          next_task_id?: string | null
          next_task_text?: string | null
          remarks?: string | null
          locked?: boolean
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_reports_next_task_id_fkey"
            columns: ["next_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      department_heads: {
        Row: {
          department_id: string
          user_id: string
          assigned_by: string | null
          assigned_at: string
        }
        Insert: {
          department_id: string
          user_id: string
          assigned_by?: string | null
          assigned_at?: string
        }
        Update: {
          department_id?: string
          user_id?: string
          assigned_by?: string | null
          assigned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_heads_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_heads_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_heads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      departments: {
        Row: {
          id: string
          name: string
          sort_order: number
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          sort_order?: number
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          user_id: string
          type: Database["public"]["Enums"]["notification_type"]
          in_app: boolean
          email: boolean
        }
        Insert: {
          user_id: string
          type: Database["public"]["Enums"]["notification_type"]
          in_app?: boolean
          email?: boolean
        }
        Update: {
          user_id?: string
          type?: Database["public"]["Enums"]["notification_type"]
          in_app?: boolean
          email?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: Database["public"]["Enums"]["notification_type"]
          project_id: string | null
          task_id: string | null
          actor_id: string | null
          title: string
          body: string | null
          link: string | null
          dedup_key: string | null
          email_wanted: boolean
          created_at: string
          read_at: string | null
          emailed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type: Database["public"]["Enums"]["notification_type"]
          project_id?: string | null
          task_id?: string | null
          actor_id?: string | null
          title: string
          body?: string | null
          link?: string | null
          dedup_key?: string | null
          email_wanted?: boolean
          created_at?: string
          read_at?: string | null
          emailed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: Database["public"]["Enums"]["notification_type"]
          project_id?: string | null
          task_id?: string | null
          actor_id?: string | null
          title?: string
          body?: string | null
          link?: string | null
          dedup_key?: string | null
          email_wanted?: boolean
          created_at?: string
          read_at?: string | null
          emailed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          login_name: string
          email: string | null
          department_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          active: boolean
          must_change_password: boolean
          legacy_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          login_name: string
          email?: string | null
          department_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          active?: boolean
          must_change_password?: boolean
          legacy_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          login_name?: string
          email?: string | null
          department_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          active?: boolean
          must_change_password?: boolean
          legacy_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      project_members: {
        Row: {
          project_id: string
          user_id: string
          member_role: Database["public"]["Enums"]["project_member_role"]
          added_by: string | null
          added_at: string
          removed_at: string | null
          removed_by: string | null
        }
        Insert: {
          project_id: string
          user_id: string
          member_role: Database["public"]["Enums"]["project_member_role"]
          added_by?: string | null
          added_at?: string
          removed_at?: string | null
          removed_by?: string | null
        }
        Update: {
          project_id?: string
          user_id?: string
          member_role?: Database["public"]["Enums"]["project_member_role"]
          added_by?: string | null
          added_at?: string
          removed_at?: string | null
          removed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      projects: {
        Row: {
          id: string
          code: string
          name: string
          description: string | null
          department_id: string
          pm_id: string | null
          status: Database["public"]["Enums"]["project_status"]
          start_date: string | null
          target_end: string | null
          notes: string | null
          task_seq: number
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          is_demo: boolean
          legacy_sheet_name: string | null
          created_at: string
          created_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          name: string
          description?: string | null
          department_id: string
          pm_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          start_date?: string | null
          target_end?: string | null
          notes?: string | null
          task_seq?: number
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          is_demo?: boolean
          legacy_sheet_name?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          name?: string
          description?: string | null
          department_id?: string
          pm_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          start_date?: string | null
          target_end?: string | null
          notes?: string | null
          task_seq?: number
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          is_demo?: boolean
          legacy_sheet_name?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_pm_id_fkey"
            columns: ["pm_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      scan_runs: {
        Row: {
          id: number
          job: string
          trigger: string
          started_at: string
          finished_at: string | null
          flagged_tasks: number | null
          new_red_marks: number | null
          notifications_created: number | null
          emails_sent: number | null
          error: string | null
        }
        Insert: {
          id?: never
          job: string
          trigger?: string
          started_at?: string
          finished_at?: string | null
          flagged_tasks?: number | null
          new_red_marks?: number | null
          notifications_created?: number | null
          emails_sent?: number | null
          error?: string | null
        }
        Update: {
          id?: never
          job?: string
          trigger?: string
          started_at?: string
          finished_at?: string | null
          flagged_tasks?: number | null
          new_red_marks?: number | null
          notifications_created?: number | null
          emails_sent?: number | null
          error?: string | null
        }
        Relationships: []
      }
      task_comments: {
        Row: {
          id: string
          task_id: string
          author_id: string
          parent_comment_id: string | null
          body: string
          is_manager_comment: boolean
          created_at: string
          edited_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          task_id: string
          author_id: string
          parent_comment_id?: string | null
          body: string
          is_manager_comment?: boolean
          created_at?: string
          edited_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          author_id?: string
          parent_comment_id?: string | null
          body?: string
          is_manager_comment?: boolean
          created_at?: string
          edited_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "task_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          }
        ]
      }
      task_contributions: {
        Row: {
          id: number
          task_id: string
          user_id: string | null
          progress_before: number | null
          progress_after: number | null
          contribution_before: number | null
          contribution_after: number | null
          daily_report_item_id: string | null
          recorded_at: string
        }
        Insert: {
          id?: never
          task_id: string
          user_id?: string | null
          progress_before?: number | null
          progress_after?: number | null
          contribution_before?: number | null
          contribution_after?: number | null
          daily_report_item_id?: string | null
          recorded_at?: string
        }
        Update: {
          id?: never
          task_id?: string
          user_id?: string | null
          progress_before?: number | null
          progress_after?: number | null
          contribution_before?: number | null
          contribution_after?: number | null
          daily_report_item_id?: string | null
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_contributions_report_item_fk"
            columns: ["daily_report_item_id"]
            isOneToOne: false
            referencedRelation: "daily_report_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_contributions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_contributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      task_extensions: {
        Row: {
          id: string
          task_id: string
          previous_deadline: string | null
          new_deadline: string
          reason: string | null
          granted_by: string | null
          granted_at: string
          source: string
        }
        Insert: {
          id?: string
          task_id: string
          previous_deadline?: string | null
          new_deadline: string
          reason?: string | null
          granted_by?: string | null
          granted_at?: string
          source?: string
        }
        Update: {
          id?: string
          task_id?: string
          previous_deadline?: string | null
          new_deadline?: string
          reason?: string | null
          granted_by?: string | null
          granted_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_extensions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_extensions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          }
        ]
      }
      tasks: {
        Row: {
          id: string
          project_id: string
          parent_id: string | null
          code: string
          type: Database["public"]["Enums"]["task_type"]
          title: string
          description: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          assigned_to: string
          assigned_by: string
          assigned_on: string
          status: Database["public"]["Enums"]["task_status"]
          plan_submitted_at: string | null
          progress_pct: number
          contribution_pct: number | null
          contribution_locked: boolean
          last_update: string | null
          last_update_at: string | null
          last_update_by: string | null
          completed_on: string | null
          planned_due_at: string | null
          extended_deadline: string | null
          extended_by: string | null
          blocker_note: string | null
          clock_start_at: string | null
          plan_due_at: string | null
          exec_due_at: string | null
          effective_due_at: string | null
          subtask_seq: number
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          legacy_row: number | null
          created_at: string
          created_by: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          parent_id?: string | null
          code: string
          type?: Database["public"]["Enums"]["task_type"]
          title: string
          description?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          assigned_to: string
          assigned_by: string
          assigned_on?: string
          status?: Database["public"]["Enums"]["task_status"]
          plan_submitted_at?: string | null
          progress_pct?: number
          contribution_pct?: number | null
          contribution_locked?: boolean
          last_update?: string | null
          last_update_at?: string | null
          last_update_by?: string | null
          completed_on?: string | null
          planned_due_at?: string | null
          extended_deadline?: string | null
          extended_by?: string | null
          blocker_note?: string | null
          clock_start_at?: string | null
          plan_due_at?: string | null
          exec_due_at?: string | null
          effective_due_at?: string | null
          subtask_seq?: number
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          legacy_row?: number | null
          created_at?: string
          created_by: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          parent_id?: string | null
          code?: string
          type?: Database["public"]["Enums"]["task_type"]
          title?: string
          description?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          assigned_to?: string
          assigned_by?: string
          assigned_on?: string
          status?: Database["public"]["Enums"]["task_status"]
          plan_submitted_at?: string | null
          progress_pct?: number
          contribution_pct?: number | null
          contribution_locked?: boolean
          last_update?: string | null
          last_update_at?: string | null
          last_update_by?: string | null
          completed_on?: string | null
          planned_due_at?: string | null
          extended_deadline?: string | null
          extended_by?: string | null
          blocker_note?: string | null
          clock_start_at?: string | null
          plan_due_at?: string | null
          exec_due_at?: string | null
          effective_due_at?: string | null
          subtask_seq?: number
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          legacy_row?: number | null
          created_at?: string
          created_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_extended_by_fkey"
            columns: ["extended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_last_update_by_fkey"
            columns: ["last_update_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      workspace_settings: {
        Row: {
          id: number
          office_start: number
          office_end: number
          plan_hours: number
          exec_days: number
          workdays: (number)[]
          timezone: string
          score_weight_on_time: number
          score_weight_clean: number
          review_window_days: number
          deadline_warning_hours: number
          daily_scan_time: string
          digest_email: string | null
          notification_retention_days: number
          report_edit_until: string
          attachment_max_mb: number
          attachment_max_files: number
          schema_version: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          office_start?: number
          office_end?: number
          plan_hours?: number
          exec_days?: number
          workdays?: (number)[]
          timezone?: string
          score_weight_on_time?: number
          score_weight_clean?: number
          review_window_days?: number
          deadline_warning_hours?: number
          daily_scan_time?: string
          digest_email?: string | null
          notification_retention_days?: number
          report_edit_until?: string
          attachment_max_mb?: number
          attachment_max_files?: number
          schema_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          office_start?: number
          office_end?: number
          plan_hours?: number
          exec_days?: number
          workdays?: (number)[]
          timezone?: string
          score_weight_on_time?: number
          score_weight_clean?: number
          review_window_days?: number
          deadline_warning_hours?: number
          daily_scan_time?: string
          digest_email?: string | null
          notification_retention_days?: number
          report_edit_until?: string
          attachment_max_mb?: number
          attachment_max_files?: number
          schema_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      task_flags: {
        Row: {
          task_id: string | null
          project_id: string | null
          assigned_to: string | null
          reasons: (Database["public"]["Enums"]["breach_reason"])[] | null
          is_red: boolean | null
          first_reason: Database["public"]["Enums"]["breach_reason"] | null
          is_late: boolean | null
          is_overdue: boolean | null
          is_plan_overdue: boolean | null
          is_due_today: boolean | null
          deadline_status: string | null
        }
        Relationships: []
      }
      task_rollup: {
        Row: {
          task_id: string | null
          project_id: string | null
          parent_id: string | null
          is_leaf: boolean | null
          sibling_share: number | null
          effective_weight: number | null
          calculated_progress: number | null
        }
        Relationships: []
      }
      v_admin_overview: {
        Row: {
          projects_total: number | null
          projects_active: number | null
          projects_on_hold: number | null
          projects_completed: number | null
          projects_cancelled: number | null
          projects_at_risk: number | null
          avg_completion_pct: number | null
          departments: number | null
          users_active: number | null
          users_inactive: number | null
          admins: number | null
          dept_heads: number | null
          pms: number | null
          engineers: number | null
          users_without_project: number | null
          red_tasks: number | null
          overdue_tasks: number | null
          last_red_mark_scan: string | null
          job_errors_7d: number | null
        }
        Relationships: []
      }
      v_department_projects: {
        Row: {
          project_id: string | null
          code: string | null
          name: string | null
          status: Database["public"]["Enums"]["project_status"] | null
          department_id: string | null
          department_name: string | null
          pm_id: string | null
          pm_name: string | null
          start_date: string | null
          target_end: string | null
          is_demo: boolean | null
          completion_pct: number | null
          planned_pct: number | null
          schedule_variance: number | null
          behind_schedule: boolean | null
          past_target: boolean | null
          leaves_total: number | null
          leaves_completed: number | null
          tasks_total: number | null
          open_tasks: number | null
          completed_tasks: number | null
          not_started: number | null
          plan_submitted: number | null
          in_progress: number | null
          blocked_tasks: number | null
          overdue_tasks: number | null
          plan_breaches: number | null
          red_tasks: number | null
          due_today: number | null
          open_important: number | null
          open_high: number | null
          extensions_7d: number | null
          members_count: number | null
          reports_expected_today: number | null
          reports_submitted_today: number | null
          at_risk: boolean | null
        }
        Relationships: []
      }
      v_department_summary: {
        Row: {
          department_id: string | null
          department_name: string | null
          active_projects: number | null
          department_progress_pct: number | null
          projects_at_risk: number | null
          red_tasks: number | null
          overdue_tasks: number | null
          completed_in_window: number | null
          on_time_pct: number | null
          extensions_in_window: number | null
          red_mark_events: number | null
          reports_submitted_today: number | null
          reports_expected_today: number | null
        }
        Relationships: []
      }
      v_engineer_project_progress: {
        Row: {
          project_id: string | null
          code: string | null
          name: string | null
          project_completion_pct: number | null
          share_pct: number | null
          delivered_pct: number | null
          personal_progress: number | null
          my_open_tasks: number | null
          report_submitted_today: boolean | null
          report_expected_today: boolean | null
        }
        Relationships: []
      }
      v_engineer_tasks: {
        Row: {
          task_id: string | null
          project_id: string | null
          project_code: string | null
          project_name: string | null
          code: string | null
          title: string | null
          type: Database["public"]["Enums"]["task_type"] | null
          parent_id: string | null
          priority: Database["public"]["Enums"]["task_priority"] | null
          status: Database["public"]["Enums"]["task_status"] | null
          progress_pct: number | null
          calculated_progress: number | null
          effective_weight: number | null
          is_leaf: boolean | null
          plan_due_at: string | null
          plan_submitted_at: string | null
          exec_due_at: string | null
          planned_due_at: string | null
          extended_deadline: string | null
          effective_due_at: string | null
          deadline_status: string | null
          is_red: boolean | null
          reasons: (Database["public"]["Enums"]["breach_reason"])[] | null
          is_overdue: boolean | null
          is_due_today: boolean | null
          is_pending: boolean | null
          due_within_7_days: boolean | null
          last_update: string | null
          blocker_note: string | null
        }
        Relationships: []
      }
      v_pm_projects: {
        Row: {
          project_id: string | null
          code: string | null
          name: string | null
          status: Database["public"]["Enums"]["project_status"] | null
          department_id: string | null
          department_name: string | null
          pm_id: string | null
          pm_name: string | null
          start_date: string | null
          target_end: string | null
          is_demo: boolean | null
          completion_pct: number | null
          planned_pct: number | null
          schedule_variance: number | null
          behind_schedule: boolean | null
          past_target: boolean | null
          leaves_total: number | null
          leaves_completed: number | null
          tasks_total: number | null
          open_tasks: number | null
          completed_tasks: number | null
          not_started: number | null
          plan_submitted: number | null
          in_progress: number | null
          blocked_tasks: number | null
          overdue_tasks: number | null
          plan_breaches: number | null
          red_tasks: number | null
          due_today: number | null
          open_important: number | null
          open_high: number | null
          extensions_7d: number | null
          members_count: number | null
          reports_expected_today: number | null
          reports_submitted_today: number | null
          at_risk: boolean | null
        }
        Relationships: []
      }
      v_pm_team_load: {
        Row: {
          project_id: string | null
          project_code: string | null
          user_id: string | null
          full_name: string | null
          member_role: Database["public"]["Enums"]["project_member_role"] | null
          open_tasks: number | null
          red_tasks: number | null
          share_pct: number | null
          delivered_pct: number | null
          personal_progress: number | null
          reported_today: boolean | null
        }
        Relationships: []
      }
      v_pm_team_updates: {
        Row: {
          report_id: string | null
          project_id: string | null
          project_code: string | null
          user_id: string | null
          full_name: string | null
          report_date: string | null
          day_name: string | null
          update_text: string | null
          issues: string | null
          next_task_text: string | null
          remarks: string | null
          submitted_at: string | null
          items: number | null
          attachments: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_dashboard: { Args: Record<PropertyKey, never>; Returns: Json }
      admin_run_job: { Args: { p_job: string }; Returns: Json }
      assignable_users: { Args: { p_project: string }; Returns: { user_id: string; full_name: string; role: Database["public"]["Enums"]["user_role"]; department: string; is_member: boolean }[] }
      complete_task: { Args: { p_task: string }; Returns: Database["public"]["Tables"]["tasks"]["Row"] }
      department_dashboard: { Args: { p_department?: string; p_from?: string; p_to?: string }; Returns: Json }
      grant_extension: { Args: { p_task: string; p_new_deadline: string; p_reason?: string }; Returns: Database["public"]["Tables"]["tasks"]["Row"] }
      member_contribution: { Args: { p_project: string }; Returns: { user_id: string; full_name: string; member_role: Database["public"]["Enums"]["project_member_role"]; open_tasks: number; share_pct: number; delivered_pct: number; personal_progress: number }[] }
      my_contribution: { Args: { p_project: string }; Returns: { share_pct: number; delivered_pct: number; personal_progress: number }[] }
      my_dashboard: { Args: Record<PropertyKey, never>; Returns: Json }
      my_performance: { Args: { p_from?: string; p_to?: string }; Returns: { user_id: string; full_name: string; department: string; assigned: number; completed: number; late: number; on_time_pct: number; red_events: number; daily_updates: number; score: number }[] }
      my_projects_dashboard: { Args: Record<PropertyKey, never>; Returns: Json }
      pending_emails: { Args: { p_limit?: number }; Returns: { notification_id: string; email: string; full_name: string; title: string; body: string; link: string; type: Database["public"]["Enums"]["notification_type"] }[] }
      performance_summary: { Args: { p_from?: string; p_to?: string; p_department?: string }; Returns: { user_id: string; full_name: string; department: string; assigned: number; completed: number; late: number; on_time_pct: number; red_events: number; daily_updates: number; score: number }[] }
      project_engineers: { Args: { p_project: string }; Returns: { user_id: string; full_name: string }[] }
      project_performance: { Args: { p_project: string; p_from?: string; p_to?: string }; Returns: { user_id: string; full_name: string; member_role: Database["public"]["Enums"]["project_member_role"]; assigned: number; completed: number; late: number; on_time_pct: number; red_events: number; daily_updates: number; score: number }[] }
      project_progress: { Args: { p_project: string }; Returns: Json }
      save_daily_report: { Args: { p: Json }; Returns: string }
      save_daily_row: { Args: { p: Json }; Returns: string }
      set_task_deadline: { Args: { p_task: string; p_due: string }; Returns: Database["public"]["Tables"]["tasks"]["Row"] }
    }
    Enums: {
      breach_reason: "plan_missing" | "exec_overdue" | "daily_update_missing" | "completed_late"
      log_action: "Assigned" | "Task created" | "Plan submitted" | "Daily update" | "Daily report submitted" | "Status change" | "Completed" | "Progress updated" | "Contribution changed" | "Extension granted" | "Red mark" | "Comment" | "Project created" | "Edited" | "Member added" | "Member removed" | "User added" | "Access denied" | "Deleted"
      log_scope: "project" | "user" | "system"
      notification_type: "task_assigned" | "deadline_approaching" | "task_overdue" | "pm_comment" | "status_changed"
      project_member_role: "pm" | "engineer"
      project_status: "Active" | "On hold" | "Completed" | "Cancelled"
      task_priority: "Important" | "High" | "Normal" | "Low"
      task_status: "Not started" | "Plan submitted" | "In progress" | "Blocked" | "Completed"
      task_type: "Task" | "Subtask"
      user_role: "admin" | "dept_head" | "pm" | "engineer"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database["public"]
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"]
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]
export type Fn<T extends keyof PublicSchema["Functions"]> = PublicSchema["Functions"][T]


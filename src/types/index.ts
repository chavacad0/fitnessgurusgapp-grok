/**
 * Shared TypeScript types for the application
 */

export interface Client {
    _id: string;
    name: string;
    email: string;
    subscription_status: 'Active' | 'Inactive';
    paid_until?: string;
    access_override?: boolean;
    coach_id: string;
}

export interface CheckIn {
    _id?: string;
    client_id: string;
    date: string;
    steps?: number;
    weight?: number;
    notes?: string;
}

export interface AutomatedRule {
    _id?: string;
    coach_id: string;
    trigger_type: 'red_flag' | 'daily_reminder' | 'missed_checkin';
    message_template: string;
    is_active: boolean;
}

export interface Coach {
    _id: string;
    name: string;
    email: string;
    whatsapp_number?: string;
}

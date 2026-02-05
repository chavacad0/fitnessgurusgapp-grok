-- ============================================
-- Fitness Coaching App - Supabase SQL Schema
-- Based on frozen v1 schema
-- ============================================

-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- ============================================
-- Core Tables
-- ============================================

-- 1. Coaches (extends auth.users)
create table coaches (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  whatsapp_number text not null,
  stripe_account_id text,
  onboarding_complete boolean not null default false,
  created_at timestamp with time zone default now()
);

-- 2. Clients (extends auth.users with simplified package tracking)
create table clients (
  id uuid primary key references auth.users(id) on delete cascade,
  coach_id uuid references coaches(id),
  name text not null,
  email text not null,
  
  -- Package & Sessions (denormalized for simplicity)
  current_package_id uuid references packages(id),
  sessions_remaining integer default 0,
  
  -- Subscription & Access
  subscription_status text 
    check (subscription_status in ('Invited', 'Active', 'Paused', 'Cancelled'))
    default 'Invited',
  paid_until date,
  access_override boolean default false,
  
  -- Profile & Goals (optional)
  target_weight_kg numeric(5, 2),
  target_waist_cm numeric(5, 2),
  daily_step_goal integer,
  birthday date,
  
  -- Compliance
  consent_whatsapp boolean default false,
  consent_data_processing boolean default false,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Indexes
create index idx_clients_coach on clients(coach_id);
create index idx_clients_subscription_status on clients(subscription_status);
create index idx_clients_email on clients(email);

-- ============================================
-- Daily Check-Ins
-- ============================================

create table check_ins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  date date default current_date,
  
  -- Metrics
  steps integer,
  hunger integer,
  energy integer,
  weight numeric,
  waist numeric,
  notes text,
  
  -- Review tracking
  flagged boolean default false,
  reviewed boolean default false,
  
  created_at timestamp with time zone default now(),
  
  -- One check-in per client per day
  unique(client_id, date)
);

-- Indexes for coach review queue and client timeline
create index idx_checkins_review on check_ins(client_id, reviewed, flagged);
create index idx_checkins_client_date on check_ins(client_id, date desc);
create index idx_checkins_flagged on check_ins(flagged) where flagged = true;

-- ============================================
-- Progress Tracking
-- ============================================

create table progress_photos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  photo_url text not null,
  photo_type text not null check (photo_type in ('front', 'side', 'back')),
  taken_at timestamp with time zone not null,
  weight_kg numeric(5, 2),
  notes text,
  visibility text not null check (visibility in ('coach_only', 'client_visible')),
  created_at timestamp with time zone default now()
);

create index idx_progress_photos_timeline on progress_photos(client_id, taken_at desc);

-- ============================================

create table measurements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  measured_at date not null,
  weight_kg numeric(5, 2),
  waist_cm numeric(5, 2),
  hip_cm numeric(5, 2),
  chest_cm numeric(5, 2),
  body_fat_pct numeric(4, 2),
  notes text,
  created_at timestamp with time zone default now()
);

create index idx_measurements_timeline on measurements(client_id, measured_at);

-- ============================================
-- Meal Plans
-- ============================================

create table meal_plans (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches(id),
  name text not null,
  description text,
  pdf_url text,
  is_template boolean not null default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table meal_plan_items (
  id uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references meal_plans(id) on delete cascade,
  day_number integer not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  description text not null,
  calories integer,
  protein_g integer,
  carbs_g integer,
  fats_g integer,
  
  unique(meal_plan_id, day_number, meal_type)
);

create table client_meal_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  meal_plan_id uuid not null references meal_plans(id),
  start_date date not null,
  end_date date,
  status text not null check (status in ('active', 'completed', 'replaced')),
  assigned_by_coach_id uuid not null references coaches(id),
  assigned_at timestamp with time zone default now()
);

create index idx_client_meal_plans_status on client_meal_plans(client_id, status);

-- ============================================
-- Sessions & Billing
-- ============================================

-- Package catalog (templates that coaches can offer)
create table packages (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches(id) on delete cascade,
  name text not null, -- e.g., "Silver", "Gold", "Platinum", "10-Session Pack"
  description text,
  sessions_included integer not null,
  price_sgd numeric(10, 2) not null,
  currency text not null default 'SGD',
  is_active boolean not null default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index idx_packages_coach on packages(coach_id, is_active);

-- Individual coaching session logs
create table sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  coach_id uuid references coaches(id),
  date date not null,
  status text check (status in ('Completed', 'No-show', 'Cancelled')),
  deducts boolean default true, -- Whether this session decrements sessions_remaining
  notes text,
  created_at timestamp with time zone default now()
);

create index idx_sessions_client on sessions(client_id, date desc);
create index idx_sessions_coach on sessions(coach_id, date desc);
create index idx_sessions_status on sessions(status) where status != 'Completed';

-- Payment records
create table payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  amount_sgd numeric(10, 2) not null,
  currency text not null default 'SGD',
  payment_method text not null check (payment_method in ('stripe', 'paynow', 'cash', 'bank_transfer')),
  stripe_payment_intent_id text,
  status text not null check (status in ('pending', 'completed', 'failed', 'refunded')),
  paid_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now()
);

-- ============================================
-- Messaging & Automation
-- ============================================

create table messages (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  content text not null,
  message_type text not null check (message_type in ('manual', 'automated')),
  sent_via text not null check (sent_via in ('in_app', 'whatsapp', 'both')),
  whatsapp_message_id text,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

create index idx_messages_conversation on messages(client_id, created_at);

create table automated_message_rules (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references coaches(id),
  trigger_type text not null check (trigger_type in ('daily_reminder', 'missed_checkin', 'low_energy', 'high_hunger')),
  message_template text not null,
  send_via text not null check (send_via in ('whatsapp', 'in_app', 'both')),
  is_active boolean not null default true,
  trigger_time time,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  notification_type text not null check (notification_type in ('check_in_reminder', 'red_flag', 'new_message', 'new_meal_plan')),
  reference_id uuid,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

create index idx_notifications_unread on notifications(user_id, read_at);

-- ============================================
-- Updated At Trigger Function
-- ============================================

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply trigger to relevant tables
create trigger update_clients_updated_at before update on clients
  for each row execute function update_updated_at_column();

create trigger update_meal_plans_updated_at before update on meal_plans
  for each row execute function update_updated_at_column();

create trigger update_packages_updated_at before update on packages
  for each row execute function update_updated_at_column();

create trigger update_automated_rules_updated_at before update on automated_message_rules
  for each row execute function update_updated_at_column();

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================

-- Enable RLS on all tables
alter table coaches enable row level security;
alter table clients enable row level security;
alter table check_ins enable row level security;
alter table progress_photos enable row level security;
alter table measurements enable row level security;
alter table meal_plans enable row level security;
alter table meal_plan_items enable row level security;
alter table client_meal_plans enable row level security;
alter table packages enable row level security;
alter table sessions enable row level security;
alter table payments enable row level security;
alter table messages enable row level security;
alter table automated_message_rules enable row level security;
alter table notifications enable row level security;

-- Coaches: Can view and edit their own profile
create policy "Coaches can view own profile"
  on coaches for select
  using (auth.uid() = id);

create policy "Coaches can update own profile"
  on coaches for update
  using (auth.uid() = id);

create policy "Coaches can insert own profile"
  on coaches for insert
  with check (auth.uid() = id);

-- Clients: Can view own profile, coaches can view their clients
create policy "Clients can view own profile"
  on clients for select
  using (auth.uid() = id);

create policy "Coaches can view their clients"
  on clients for select
  using (auth.uid() = coach_id);

create policy "Clients can update own profile"
  on clients for update
  using (auth.uid() = id);

create policy "Coaches can update their clients"
  on clients for update
  using (auth.uid() = coach_id);

create policy "Coaches can insert clients"
  on clients for insert
  with check (auth.uid() = coach_id);

-- Check-ins: Clients can CRUD own, coaches can read their clients' check-ins
create policy "Clients can manage own check-ins"
  on check_ins for all
  using (client_id = auth.uid());

create policy "Coaches can view client check-ins"
  on check_ins for select
  using (
    client_id in (
      select id from clients where coach_id = auth.uid()
    )
  );

create policy "Coaches can update client check-ins"
  on check_ins for update
  using (
    client_id in (
      select id from clients where coach_id = auth.uid()
    )
  );

-- Progress Photos: Same pattern as check-ins
create policy "Clients can manage own progress photos"
  on progress_photos for all
  using (client_id = auth.uid());

create policy "Coaches can view client progress photos"
  on progress_photos for select
  using (
    client_id in (
      select id from clients where coach_id = auth.uid()
    )
  );

-- Measurements: Same pattern
create policy "Clients can manage own measurements"
  on measurements for all
  using (client_id = auth.uid());

create policy "Coaches can view client measurements"
  on measurements for select
  using (
    client_id in (
      select id from clients where coach_id = auth.uid()
    )
  );

-- Meal Plans: Coaches manage, clients can view assigned plans
create policy "Coaches can manage own meal plans"
  on meal_plans for all
  using (auth.uid() = coach_id);

create policy "Coaches can manage meal plan items"
  on meal_plan_items for all
  using (
    meal_plan_id in (
      select id from meal_plans where coach_id = auth.uid()
    )
  );

create policy "Clients can view assigned meal plans"
  on client_meal_plans for select
  using (client_id = auth.uid());

create policy "Coaches can manage client meal plan assignments"
  on client_meal_plans for all
  using (
    client_id in (
      select id from clients where coach_id = auth.uid()
    )
  );

-- Messages: Both parties can view, sender can create
create policy "Users can view own messages"
  on messages for select
  using (
    auth.uid() = sender_id or
    auth.uid() = client_id or
    auth.uid() in (
      select coach_id from clients where id = messages.client_id
    )
  );

create policy "Users can send messages"
  on messages for insert
  with check (auth.uid() = sender_id);

-- Notifications: Users can view and update own
create policy "Users can view own notifications"
  on notifications for select
  using (auth.uid() = user_id);

create policy "Users can update own notifications"
  on notifications for update
  using (auth.uid() = user_id);

-- Package Catalog: Coaches manage their own package offerings
create policy "Coaches can manage own packages"
  on packages for all
  using (auth.uid() = coach_id);

create policy "Clients can view their coach's packages"
  on packages for select
  using (
    coach_id in (
      select coach_id from clients where id = auth.uid()
    )
  );

-- Sessions: Both coach and client can view, only coach can create
create policy "Sessions viewable by coach and client"
  on sessions for select
  using (
    auth.uid() = coach_id or
    auth.uid() = client_id
  );

create policy "Coaches can create and update sessions"
  on sessions for all
  using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id);

-- Payments: Client and coach can view
create policy "Payments viewable by client and coach"
  on payments for select
  using (
    auth.uid() = client_id or
    auth.uid() in (
      select coach_id from clients where id = payments.client_id
    )
  );

-- ============================================
-- Helper Functions
-- ============================================

-- Function to get coach's active clients
create or replace function get_coach_active_clients(coach_uuid uuid)
returns table (
  client_id uuid,
  client_name text,
  client_email text,
  subscription_status text,
  last_checkin_date date
) as $$
begin
  return query
  select 
    c.id,
    c.name,
    c.email,
    c.subscription_status,
    (select max(date) from check_ins where client_id = c.id) as last_checkin_date
  from clients c
  where c.coach_id = coach_uuid
    and c.subscription_status in ('Active', 'Invited')
  order by c.created_at desc;
end;
$$ language plpgsql security definer;

-- Function to detect red flags for a client
create or replace function detect_red_flags(client_uuid uuid)
returns jsonb as $$
declare
  flags jsonb := '[]'::jsonb;
  last_checkin_date date;
  days_since_checkin integer;
  low_energy_count integer;
  high_hunger_count integer;
begin
  -- Check for missed check-ins
  select max(date) into last_checkin_date
  from check_ins
  where client_id = client_uuid;
  
  days_since_checkin := current_date - last_checkin_date;
  
  if days_since_checkin >= 2 then
    flags := flags || jsonb_build_object(
      'type', 'MISSED_CHECKIN',
      'severity', case when days_since_checkin >= 5 then 'high' else 'medium' end,
      'message', format('No check-in for %s days', days_since_checkin)
    );
  end if;
  
  -- Check for low energy trend
  select count(*) into low_energy_count
  from check_ins
  where client_id = client_uuid
    and date >= current_date - interval '7 days'
    and energy_level < 4;
  
  if low_energy_count >= 3 then
    flags := flags || jsonb_build_object(
      'type', 'LOW_ENERGY',
      'severity', 'high',
      'message', format('%s low energy days this week', low_energy_count)
    );
  end if;
  
  -- Check for high hunger trend
  select count(*) into high_hunger_count
  from check_ins
  where client_id = client_uuid
    and date >= current_date - interval '7 days'
    and hunger_level > 7;
  
  if high_hunger_count >= 3 then
    flags := flags || jsonb_build_object(
      'type', 'HIGH_HUNGER',
      'severity', 'medium',
      'message', format('%s high hunger days this week', high_hunger_count)
    );
  end if;
  
  return flags;
end;
$$ language plpgsql security definer;

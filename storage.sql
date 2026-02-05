-- ============================================
-- Storage Buckets for File Uploads
-- ============================================

-- Create buckets (run in Supabase dashboard or via SQL)
insert into storage.buckets (id, name, public)
values 
  ('meal-photos', 'meal-photos', false),
  ('progress-photos', 'progress-photos', false),
  ('meal-plan-pdfs', 'meal-plan-pdfs', false),
  ('avatars', 'avatars', true);

-- ============================================
-- Storage Policies for meal-photos bucket
-- ============================================

-- Clients can upload their own meal photos
create policy "Clients can upload meal photos"
  on storage.objects for insert
  with check (
    bucket_id = 'meal-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Clients can view their own meal photos
create policy "Clients can view own meal photos"
  on storage.objects for select
  using (
    bucket_id = 'meal-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Coaches can view their clients' meal photos
create policy "Coaches can view client meal photos"
  on storage.objects for select
  using (
    bucket_id = 'meal-photos' and
    (storage.foldername(name))[1]::uuid in (
      select user_id::text from clients where coach_id = auth.uid()
    )
  );

-- Clients can delete their own meal photos
create policy "Clients can delete own meal photos"
  on storage.objects for delete
  using (
    bucket_id = 'meal-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================
-- Storage Policies for progress-photos bucket
-- ============================================

-- Clients can upload progress photos
create policy "Clients can upload progress photos"
  on storage.objects for insert
  with check (
    bucket_id = 'progress-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Clients can view own progress photos
create policy "Clients can view own progress photos"
  on storage.objects for select
  using (
    bucket_id = 'progress-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Coaches can view their clients' progress photos
create policy "Coaches can view client progress photos"
  on storage.objects for select
  using (
    bucket_id = 'progress-photos' and
    (storage.foldername(name))[1]::uuid in (
      select user_id::text from clients where coach_id = auth.uid()
    )
  );

-- ============================================
-- Storage Policies for meal-plan-pdfs bucket
-- ============================================

-- Coaches can upload PDFs
create policy "Coaches can upload meal plan PDFs"
  on storage.objects for insert
  with check (
    bucket_id = 'meal-plan-pdfs' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Coaches can view own PDFs
create policy "Coaches can view own meal plan PDFs"
  on storage.objects for select
  using (
    bucket_id = 'meal-plan-pdfs' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Clients can view PDFs from assigned meal plans
create policy "Clients can view assigned meal plan PDFs"
  on storage.objects for select
  using (
    bucket_id = 'meal-plan-pdfs' and
    (storage.foldername(name))[1]::uuid in (
      select coach_id::text from clients where user_id = auth.uid()
    )
  );

-- ============================================
-- Storage Policies for avatars bucket (public)
-- ============================================

-- Anyone authenticated can upload avatar
create policy "Users can upload own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Anyone can view avatars (public bucket)
create policy "Avatars are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Users can update own avatar
create policy "Users can update own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can delete own avatar
create policy "Users can delete own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

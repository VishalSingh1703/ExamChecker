-- Run in Supabase Dashboard → SQL Editor
-- Replace 'YOUR_ADMIN_EMAIL' with your actual email

CREATE TABLE IF NOT EXISTS user_access (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revoked')),
  trial_ends_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_access ENABLE ROW LEVEL SECURITY;

-- Users can insert their own access request
CREATE POLICY "Insert own" ON user_access
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users read their own row; admin reads all
CREATE POLICY "Read own or admin" ON user_access
  FOR SELECT USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'YOUR_ADMIN_EMAIL'
  );

-- Only admin can update (approve/revoke)
CREATE POLICY "Admin update" ON user_access
  FOR UPDATE USING (
    (auth.jwt() ->> 'email') = 'YOUR_ADMIN_EMAIL'
  );

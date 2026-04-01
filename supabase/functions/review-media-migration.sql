ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS reviewer_phone TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS review_image_url TEXT;

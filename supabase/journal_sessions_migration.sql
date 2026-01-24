-- =====================================================
-- Journal Sessions Enhancement Migration
-- Adds journal_type field to distinguish free vs guided
-- =====================================================

-- 1. Add journal_type column to journal_threads
ALTER TABLE journal_threads 
ADD COLUMN IF NOT EXISTS journal_type TEXT 
CHECK (journal_type IN ('free', 'guided'));

-- 2. Set default to 'free' for existing threads
UPDATE journal_threads 
SET journal_type = 'free' 
WHERE journal_type IS NULL;

-- 3. Make journal_type NOT NULL after setting defaults
ALTER TABLE journal_threads 
ALTER COLUMN journal_type SET NOT NULL,
ALTER COLUMN journal_type SET DEFAULT 'free';

-- 4. Update the get_or_create_active_thread function to support journal type
CREATE OR REPLACE FUNCTION get_or_create_active_thread(
  p_user_id UUID,
  p_journal_type TEXT DEFAULT 'free'
)
RETURNS UUID AS $$
DECLARE
  v_thread_id UUID;
BEGIN
  -- Try to find an active thread from today of the same type
  SELECT id INTO v_thread_id
  FROM journal_threads
  WHERE user_id = p_user_id
    AND status = 'active'
    AND journal_type = p_journal_type
    AND DATE(created_at) = CURRENT_DATE
  ORDER BY last_message_at DESC
  LIMIT 1;

  -- If no thread exists, create one with appropriate title
  IF v_thread_id IS NULL THEN
    INSERT INTO journal_threads (user_id, title, journal_type)
    VALUES (
      p_user_id, 
      CASE 
        WHEN p_journal_type = 'guided' THEN 'Guided Journal - ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI')
        ELSE 'Free Journal - ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI')
      END,
      p_journal_type
    )
    RETURNING id INTO v_thread_id;
  END IF;

  RETURN v_thread_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create function to get user's journal threads (for sidebar)
CREATE OR REPLACE FUNCTION get_user_journal_threads(
  p_user_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  journal_type TEXT,
  status TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  message_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.title,
    t.journal_type,
    t.status,
    t.last_message_at,
    t.created_at,
    COUNT(m.id) as message_count
  FROM journal_threads t
  LEFT JOIN journal_messages m ON m.thread_id = t.id
  WHERE t.user_id = p_user_id
  GROUP BY t.id, t.title, t.journal_type, t.status, t.last_message_at, t.created_at
  ORDER BY t.last_message_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create function to auto-generate better titles using first user message
CREATE OR REPLACE FUNCTION generate_thread_title()
RETURNS TRIGGER AS $$
DECLARE
  v_thread_title TEXT;
BEGIN
  -- Only generate title for first user message in thread
  IF NEW.role = 'user' AND NEW.thread_id IS NOT NULL THEN
    -- Check if this is the first user message
    IF NOT EXISTS (
      SELECT 1 FROM journal_messages 
      WHERE thread_id = NEW.thread_id 
        AND role = 'user' 
        AND id != NEW.id
    ) THEN
      -- Generate title from first 50 characters of content
      v_thread_title := SUBSTRING(NEW.content FROM 1 FOR 50);
      IF LENGTH(NEW.content) > 50 THEN
        v_thread_title := v_thread_title || '...';
      END IF;
      
      -- Update the thread title
      UPDATE journal_threads
      SET title = v_thread_title
      WHERE id = NEW.thread_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger for auto-generating titles
DROP TRIGGER IF EXISTS trigger_generate_thread_title ON journal_messages;
CREATE TRIGGER trigger_generate_thread_title
  AFTER INSERT ON journal_messages
  FOR EACH ROW
  EXECUTE FUNCTION generate_thread_title();

-- 8. Create index for faster thread queries by type
CREATE INDEX IF NOT EXISTS idx_threads_user_type_updated 
  ON journal_threads(user_id, journal_type, last_message_at DESC);

-- 9. Create function to get messages for a specific thread
CREATE OR REPLACE FUNCTION get_thread_messages(
  p_thread_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  id UUID,
  role TEXT,
  content TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.role,
    m.content,
    m.created_at
  FROM journal_messages m
  WHERE m.thread_id = p_thread_id
    AND m.user_id = p_user_id
  ORDER BY m.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Create function to delete a thread and all its messages
CREATE OR REPLACE FUNCTION delete_thread(
  p_thread_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_count INT;
BEGIN
  -- Verify ownership
  SELECT COUNT(*) INTO v_count
  FROM journal_threads
  WHERE id = p_thread_id AND user_id = p_user_id;
  
  IF v_count = 0 THEN
    RETURN FALSE;
  END IF;
  
  -- Delete messages first (CASCADE should handle this, but being explicit)
  DELETE FROM journal_messages
  WHERE thread_id = p_thread_id AND user_id = p_user_id;
  
  -- Delete thread
  DELETE FROM journal_threads
  WHERE id = p_thread_id AND user_id = p_user_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Create function to archive old threads (keep data, mark as archived)
CREATE OR REPLACE FUNCTION archive_old_threads(
  p_user_id UUID,
  p_days_old INT DEFAULT 30
)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE journal_threads
  SET status = 'archived'
  WHERE user_id = p_user_id
    AND status = 'active'
    AND last_message_at < NOW() - INTERVAL '1 day' * p_days_old
    AND id IN (
      SELECT DISTINCT thread_id 
      FROM journal_messages 
      WHERE user_id = p_user_id
    );
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- This migration adds:
-- 1. journal_type column to distinguish free vs guided
-- 2. Enhanced get_or_create_active_thread function
-- 3. get_user_journal_threads function for sidebar
-- 4. Auto-title generation from first message
-- 5. get_thread_messages function to load conversation history
-- 6. delete_thread function for removing sessions
-- 7. archive_old_threads function for cleanup
-- 8. Appropriate indexes for performance
-- =====================================================

-- Ensure activity feed RPCs return rows sorted newest-first.
-- Re-creates both get_activity_feed (child) and add_activity_item with correct ordering.

CREATE OR REPLACE FUNCTION get_activity_feed(p_child_id uuid, p_limit int DEFAULT 20)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_agg(row_to_json(r))
  INTO   v_result
  FROM (
    SELECT id, emoji, text, type, created_at
    FROM   activity_feed
    WHERE  child_id = p_child_id
    ORDER  BY created_at DESC
    LIMIT  p_limit
  ) r;
  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- add_activity_item: idempotent insert (ON CONFLICT DO NOTHING keeps created_at of first write)
CREATE OR REPLACE FUNCTION add_activity_item(
  p_child_id uuid,
  p_id       text,
  p_emoji    text,
  p_text     text,
  p_type     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO activity_feed (child_id, id, emoji, text, type)
  VALUES (p_child_id, p_id, p_emoji, p_text, p_type)
  ON CONFLICT (id) DO NOTHING;
END;
$$;

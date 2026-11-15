-- Visible Vinted inbox URLs now also use UUIDs. Keep the numeric IDs already
-- stored by older clients while matching the API's existing cid validator.
-- The previous numeric-only check caused agent_context to fail with 23514.
alter table public.ylavint_conversations
  drop constraint ylavint_conversations_conversation_id_check,
  add constraint ylavint_conversations_conversation_id_check
  check (conversation_id ~* '^([1-9][0-9]{0,17}|[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})$');

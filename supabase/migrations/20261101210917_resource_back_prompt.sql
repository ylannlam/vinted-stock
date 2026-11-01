-- Keep existing content as the front prompt, without rewriting any saved text.
alter table public.creative_resources
  add column content_back text not null default '' check(length(content_back)<=50000);

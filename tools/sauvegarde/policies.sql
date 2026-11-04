-- The standard dump excludes auth/storage schema changes. Read their custom policies.
SET search_path = '';
SELECT '-- Auth/storage policies';
SELECT format('DROP POLICY IF EXISTS %I ON %I.%I;', policyname, schemaname, tablename)
  || E'\n' || format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
    policyname, schemaname, tablename, permissive, cmd,
    (SELECT string_agg(quote_ident(role), ', ') FROM unnest(roles) role),
    CASE WHEN qual IS NULL THEN '' ELSE ' USING (' || qual || ')' END,
    CASE WHEN with_check IS NULL THEN '' ELSE ' WITH CHECK (' || with_check || ')' END)
FROM pg_policies WHERE schemaname IN ('auth', 'storage')
ORDER BY schemaname, tablename, policyname;

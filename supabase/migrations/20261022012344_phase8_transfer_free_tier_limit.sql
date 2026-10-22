begin;
-- Stay below Supabase Free's 50 MB global file limit without changing plans
-- or any project's global Storage settings. Already-applied migrations stay intact.
update storage.buckets set file_size_limit=41943040 where id='palm-transfers';
alter table private.transfer_jobs drop constraint transfer_jobs_size_bytes_check;
alter table private.transfer_jobs add constraint transfer_jobs_size_bytes_check check(size_bytes between 1 and 41943040);
commit;

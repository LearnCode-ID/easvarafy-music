-- Private playlist artwork. Persist a reference, never a public/signed URL.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('playlist-covers','playlist-covers',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

create or replace function public.playlist_cover_is_public(object_name text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from public.user_playlists up
   where up.cover_url='playlist-covers:'||object_name
     and split_part(object_name,'/',1)=up.user_id::text
     and up.is_public and public.profile_is_public(up.user_id)
 );
$$;
revoke all on function public.playlist_cover_is_public(text) from public;
grant execute on function public.playlist_cover_is_public(text) to anon,authenticated;

create policy playlist_covers_read on storage.objects for select to anon,authenticated
 using(bucket_id='playlist-covers' and (
   (storage.foldername(name))[1]=auth.uid()::text or public.playlist_cover_is_public(name)
 ));
create policy playlist_covers_insert on storage.objects for insert to authenticated
 with check(bucket_id='playlist-covers' and (storage.foldername(name))[1]=auth.uid()::text);
create policy playlist_covers_delete on storage.objects for delete to authenticated
 using(bucket_id='playlist-covers' and (storage.foldername(name))[1]=auth.uid()::text);
-- No UPDATE policy: new immutable object names avoid overwriting a visible cover.

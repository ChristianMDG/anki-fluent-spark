
CREATE POLICY "fluency_recordings_select_own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'fluency-recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "fluency_recordings_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'fluency-recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "fluency_recordings_update_own" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'fluency-recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "fluency_recordings_delete_own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'fluency-recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

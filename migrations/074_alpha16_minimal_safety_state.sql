-- Current independent safety evidence only. No Run, attempt, actor, result,
-- payload, history copy, activation, or operating lifetime is installed here.
ALTER TABLE rule_target_safety ADD COLUMN verified_generation text;
ALTER TABLE rule_target_safety ADD COLUMN verified_at timestamptz;
ALTER TABLE rule_target_safety ADD CHECK((verified_generation IS NULL)=(verified_at IS NULL));
ALTER TABLE official_static_publication_heads ADD COLUMN safety_expires_at timestamptz;
ALTER TABLE official_static_publication_heads ADD COLUMN safety_policy_revision text;
ALTER TABLE official_static_publication_heads ADD COLUMN verified_generation text;
ALTER TABLE official_static_publication_heads ADD COLUMN verified_at timestamptz;
ALTER TABLE official_static_publication_heads ADD COLUMN active_artifact_hash text CHECK(active_artifact_hash~'^[a-f0-9]{64}$');
ALTER TABLE official_static_publication_heads ADD CHECK(num_nonnulls(safety_expires_at,safety_policy_revision,verified_generation,verified_at) IN (0,4));
-- Current delivery configuration distinguishes legacy sources from static
-- sources after a finite safety head is purged. It stores no execution history.
ALTER TABLE official_publications ADD COLUMN delivery_mode text NOT NULL DEFAULT 'LEGACY' CHECK(delivery_mode IN ('LEGACY','STATIC'));
UPDATE official_publications p SET delivery_mode='STATIC' WHERE EXISTS(SELECT 1 FROM official_static_publication_heads h WHERE h.publication_id=p.id);
CREATE FUNCTION nexus_static_delivery_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE official_publications SET delivery_mode='STATIC' WHERE id=NEW.publication_id;
 RETURN NEW;
END $$;
CREATE TRIGGER static_delivery_configuration AFTER INSERT ON official_static_publication_heads
 FOR EACH ROW EXECUTE FUNCTION nexus_static_delivery_configuration();
-- A finite head's erasure cannot silently turn an established static route
-- back into the old PC-hosted delivery path. Changing delivery is a separate
-- migration/configuration operation; ordinary source edits cannot do it.
CREATE FUNCTION nexus_preserve_static_delivery_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.delivery_mode='STATIC' AND NEW.delivery_mode<>'STATIC' THEN
  RAISE EXCEPTION 'Static delivery requires an explicit migration';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_static_delivery_configuration BEFORE UPDATE OF delivery_mode ON official_publications
 FOR EACH ROW EXECUTE FUNCTION nexus_preserve_static_delivery_configuration();
-- Legacy rows remain unverified and closed to external admission. Readers never
-- infer an independent safety lifetime from publication-history retention.

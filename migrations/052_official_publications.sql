-- Official-site content is independent of guild records and their purge jobs.
CREATE TABLE official_publications (
 id uuid PRIMARY KEY,
 revision integer NOT NULL CHECK(revision>0),
 edit_revision integer,
 published_revision integer,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','WITHDRAWN')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 first_published_at timestamptz,
 published_updated_at timestamptz,
 CHECK(status<>'PUBLISHED' OR (published_revision IS NOT NULL AND first_published_at IS NOT NULL))
);
CREATE TABLE official_publication_revisions (
 publication_id uuid NOT NULL REFERENCES official_publications(id),
 revision integer NOT NULL CHECK(revision>0),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(publication_id,revision)
);
ALTER TABLE official_publications ADD CONSTRAINT official_edit_revision
 FOREIGN KEY(id,edit_revision) REFERENCES official_publication_revisions(publication_id,revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE official_publications ADD CONSTRAINT official_published_revision
 FOREIGN KEY(id,published_revision) REFERENCES official_publication_revisions(publication_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX official_publications_recent ON official_publications(first_published_at DESC,id DESC) WHERE status='PUBLISHED';
-- Request records contain metadata only, never duplicate private drafts/settings.
CREATE TABLE official_publication_requests (
 id uuid PRIMARY KEY,
 fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 publication_id uuid,
 action text NOT NULL CHECK(action IN ('save','publish','withdraw','discard','legal')),
 revision integer NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE official_publication_audit (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE REFERENCES official_publication_requests(id),
 publication_id uuid,
 actor text NOT NULL CHECK(actor='local-operator'),
 action text NOT NULL CHECK(action IN ('save','publish','withdraw','discard','legal')),
 revision integer NOT NULL,
 result text NOT NULL CHECK(result='SUCCEEDED'),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE official_legal_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(settings)='object'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO official_legal_settings(singleton) VALUES(true);

-- Revisions are append-only, including after withdrawal or draft discard.
CREATE FUNCTION reject_official_publication_revision_change() RETURNS trigger
 LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'OFFICIAL_REVISION_IMMUTABLE'; END $$;
CREATE TRIGGER official_revision_immutable BEFORE UPDATE OR DELETE ON official_publication_revisions
 FOR EACH ROW EXECUTE FUNCTION reject_official_publication_revision_change();

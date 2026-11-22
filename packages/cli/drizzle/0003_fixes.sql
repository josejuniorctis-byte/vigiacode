-- Correções da Etapa 4 (nada aqui edita 0000–0002).
--
-- 1. Bancos criados na Etapa 3 podem ter bindings duplicados (a tabela ainda não
--    tinha rule_id). Como amarrações são recalculáveis, descartamos as duplicatas
--    mantendo o registro mais recente antes de garantir o índice de identidade.
DELETE FROM `bindings` WHERE rowid NOT IN (
	SELECT MAX(rowid) FROM `bindings` GROUP BY project_id, rule_id, layer, entity, field
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `bindings_identity_idx` ON `bindings` (`project_id`,`rule_id`,`layer`,`entity`,`field`);--> statement-breakpoint
-- 2. Timestamps legados (default '1970-01-01') recebem a data desta migração.
UPDATE `bindings` SET first_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE first_seen_at = '1970-01-01T00:00:00.000Z';--> statement-breakpoint
UPDATE `bindings` SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE last_seen_at = '1970-01-01T00:00:00.000Z';--> statement-breakpoint
-- 3. Cache de extração é derivado: limpo para forçar reextração no próximo scan.
DELETE FROM `binding_file_cache`;--> statement-breakpoint
-- 4. Índice redundante (o unique por project_id + file_path já cobre as buscas).
DROP INDEX IF EXISTS `binding_file_cache_project_idx`;--> statement-breakpoint
-- 5. Cobertura por regra congelada em cada scan (dashboard/API/MCP).
ALTER TABLE `binding_scans` ADD `coverage_json` text;--> statement-breakpoint
-- 6. Flag de rescan completo por projeto (coluna precisa existir antes do UPDATE).
ALTER TABLE `projects` ADD `bindings_rescan_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- 7. Marca todos os projetos para um rescan completo na próxima execução.
UPDATE `projects` SET `bindings_rescan_required` = 1;

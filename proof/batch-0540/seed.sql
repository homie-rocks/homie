WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<500) INSERT INTO office_games(game,launch,max_players,updated_at) SELECT 'seed-'||i,'public',8,1 FROM n;
WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1500) INSERT INTO servers(game,id,name,blurb,policy,created_at,updated_at) SELECT 'seed-'||((i-1)%500+1),'server-'||i,'Community '||i,'Populated benchmark community','open',1,1 FROM n;
WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1000) INSERT INTO chat_rules(game,server,rules,updated_at) SELECT 'seed-'||((i-1)%500+1),'server-'||i,'{"mode":"text","who":"signed-in","max":140}',1 FROM n;
SELECT (SELECT count(*) FROM office_games) launches,(SELECT count(*) FROM servers) servers,(SELECT count(*) FROM chat_rules) chat_rules;

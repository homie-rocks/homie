
CREATE TABLE function_runs (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 function TEXT NOT NULL, event TEXT NOT NULL, trigger TEXT NOT NULL,
 started INTEGER NOT NULL, finished INTEGER, outcome TEXT NOT NULL,
 error TEXT, attempt INTEGER NOT NULL
);
CREATE INDEX function_runs_function_seq ON function_runs(function,seq);
CREATE INDEX function_runs_errors_seq ON function_runs(seq) WHERE outcome IN ('failed','interrupted');

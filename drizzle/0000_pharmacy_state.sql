CREATE TABLE `pharmacy_state` (
  `store_id` text PRIMARY KEY NOT NULL,
  `version` integer DEFAULT 0 NOT NULL,
  `data` text NOT NULL
);

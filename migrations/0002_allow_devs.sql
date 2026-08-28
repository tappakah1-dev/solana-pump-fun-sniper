-- Trusted DEV wallets, synced from the desk UI.
-- Scoped per user. `address` is the lowercased key, `original` keeps the pasted
-- casing, `label` is the optional # label from the paste box.
create table if not exists allow_devs (
  user_id text not null,
  address text not null,
  original text,
  label text,
  created_at timestamptz default CURRENT_TIMESTAMP not null,
  primary key (user_id, address)
);

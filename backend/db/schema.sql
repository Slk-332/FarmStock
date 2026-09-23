-- FarmStock — โครงสร้างฐานข้อมูล
-- สร้างอัตโนมัติจาก scripts/dump-schema.js เมื่อ 2026-09-22T15:22:58.350Z
-- ต้นทาง: db.rtcitmexhvqvzupvhkod.supabase.co
--
-- ไฟล์นี้ generate ขึ้นมา ห้ามแก้มือ — ถ้าจะเปลี่ยนโครงสร้างให้เขียน migration แล้ว dump ใหม่

-- ─────────── ตาราง ───────────

CREATE TABLE IF NOT EXISTS "area" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "area_code" varchar(30) NOT NULL,
  "name" varchar(200) NOT NULL,
  "note" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "area_pkey" PRIMARY KEY (id),
  CONSTRAINT "area_area_code_key" UNIQUE (area_code)
);

CREATE TABLE IF NOT EXISTS "attachment" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "ref_type" varchar(30) NOT NULL,
  "ref_id" uuid NOT NULL,
  "file_name" varchar(255),
  "file_url" text NOT NULL,
  "note" text,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "attachment_ref_type_check" CHECK (((ref_type)::text = ANY ((ARRAY['purchase_order'::character varying, 'goods_receipt'::character varying])::text[]))),
  CONSTRAINT "attachment_pkey" PRIMARY KEY (id)
);
CREATE INDEX attachment_ref_type_ref_id_index ON public.attachment USING btree (ref_type, ref_id);

CREATE TABLE IF NOT EXISTS "dispense" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "item_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "qty_dispensed" integer DEFAULT 1 NOT NULL,
  "qty_used" integer DEFAULT 1 NOT NULL,
  "qty_waste" integer DEFAULT 0 NOT NULL,
  "cost_per_piece" numeric(12,2) NOT NULL,
  "total_cost" numeric(12,2) NOT NULL,
  "remark" text,
  "status" varchar(20) DEFAULT 'active'::character varying NOT NULL,
  "dispensed_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_by" uuid,
  CONSTRAINT "dispense_status_check" CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('edited'::character varying)::text, ('cancelled'::character varying)::text]))),
  CONSTRAINT "dispense_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_dispense_date ON public.dispense USING btree (dispensed_at);
CREATE INDEX idx_dispense_item ON public.dispense USING btree (item_id);
CREATE INDEX idx_dispense_user ON public.dispense USING btree (user_id);

CREATE TABLE IF NOT EXISTS "formula" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "std_code" varchar(30) NOT NULL,
  "name" varchar(200) NOT NULL,
  "gtf_no" varchar(60),
  "ferment_days" integer DEFAULT 0 NOT NULL,
  "shelf_life_days" integer DEFAULT 0 NOT NULL,
  "output_product_id" uuid NOT NULL,
  "output_qty" numeric(18,4) NOT NULL,
  "output_unit" varchar(20) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "note" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "formula_days_check" CHECK (((ferment_days >= 0) AND (shelf_life_days >= 0))),
  CONSTRAINT "formula_output_qty_check" CHECK ((output_qty > (0)::numeric)),
  CONSTRAINT "formula_pkey" PRIMARY KEY (id),
  CONSTRAINT "formula_std_code_key" UNIQUE (std_code)
);
CREATE INDEX formula_is_active_index ON public.formula USING btree (is_active);
CREATE INDEX formula_output_product_id_index ON public.formula USING btree (output_product_id);

CREATE TABLE IF NOT EXISTS "formula_line" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "formula_id" uuid NOT NULL,
  "seq" integer DEFAULT 1 NOT NULL,
  "product_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_code" varchar(20) NOT NULL,
  "note" text,
  CONSTRAINT "formula_line_qty_check" CHECK ((qty > (0)::numeric)),
  CONSTRAINT "formula_line_pkey" PRIMARY KEY (id)
);
CREATE INDEX formula_line_formula_id_index ON public.formula_line USING btree (formula_id);
CREATE INDEX formula_line_product_id_index ON public.formula_line USING btree (product_id);

CREATE TABLE IF NOT EXISTS "goods_receipt" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "receipt_no" varchar(30) NOT NULL,
  "receipt_date" date DEFAULT CURRENT_DATE NOT NULL,
  "order_id" uuid,
  "supplier" varchar(200),
  "note" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goods_receipt_pkey" PRIMARY KEY (id),
  CONSTRAINT "goods_receipt_receipt_no_key" UNIQUE (receipt_no)
);
CREATE INDEX goods_receipt_order_id_index ON public.goods_receipt USING btree (order_id);
CREATE INDEX goods_receipt_receipt_date_index ON public.goods_receipt USING btree (receipt_date);

CREATE TABLE IF NOT EXISTS "goods_receipt_line" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "receipt_id" uuid NOT NULL,
  "order_line_id" uuid,
  "product_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_code" varchar(20) NOT NULL,
  "unit_price" numeric(18,4) DEFAULT 0 NOT NULL,
  "total_price" numeric(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT "goods_receipt_line_qty_check" CHECK ((qty > (0)::numeric)),
  CONSTRAINT "goods_receipt_line_pkey" PRIMARY KEY (id)
);
CREATE INDEX goods_receipt_line_lot_id_index ON public.goods_receipt_line USING btree (lot_id);
CREATE INDEX goods_receipt_line_receipt_id_index ON public.goods_receipt_line USING btree (receipt_id);

CREATE TABLE IF NOT EXISTS "item" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "item_id" varchar(100) NOT NULL,
  "lot_id" uuid NOT NULL,
  "print_status" varchar(20) DEFAULT 'pending'::character varying NOT NULL,
  "printed_at" timestamp without time zone,
  "status" varchar(20) DEFAULT 'active'::character varying NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "content_size" numeric(18,4),
  "content_unit" varchar(20),
  "content_remaining" numeric(18,4),
  CONSTRAINT "item_content_remaining_check" CHECK (((content_remaining IS NULL) OR (content_remaining >= (0)::numeric))),
  CONSTRAINT "item_print_status_check" CHECK (((print_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('printed'::character varying)::text]))),
  CONSTRAINT "item_status_check" CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('dispensed'::character varying)::text, ('expired'::character varying)::text, ('waste'::character varying)::text]))),
  CONSTRAINT "item_pkey" PRIMARY KEY (id),
  CONSTRAINT "item_item_id_key" UNIQUE (item_id)
);
CREATE INDEX idx_item_lot ON public.item USING btree (lot_id);
CREATE INDEX idx_item_print_status ON public.item USING btree (print_status);
CREATE INDEX idx_item_status ON public.item USING btree (status);

CREATE TABLE IF NOT EXISTS "lot" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "lot_no" varchar(50) NOT NULL,
  "product_id" uuid NOT NULL,
  "qty_received" integer NOT NULL,
  "qty_remaining" integer DEFAULT 0 NOT NULL,
  "cost" numeric(12,2) NOT NULL,
  "ave_cost" numeric(12,2) DEFAULT 0 NOT NULL,
  "mfg_date" date NOT NULL,
  "exp_date" date NOT NULL,
  "shelf_life_days" integer,
  "supplier" varchar(150),
  "status" varchar(20) DEFAULT 'active'::character varying NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lot_qty_received_check" CHECK ((qty_received > 0)),
  CONSTRAINT "lot_status_check" CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('done'::character varying)::text, ('expired'::character varying)::text]))),
  CONSTRAINT "lot_pkey" PRIMARY KEY (id),
  CONSTRAINT "lot_no_product_unique" UNIQUE (lot_no, product_id)
);
CREATE INDEX idx_lot_exp_date ON public.lot USING btree (exp_date);
CREATE INDEX idx_lot_product ON public.lot USING btree (product_id);
CREATE INDEX idx_lot_status ON public.lot USING btree (status);

CREATE TABLE IF NOT EXISTS "mixing_consumption" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "mixing_order_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_code" varchar(20) NOT NULL,
  "cost" numeric(18,4) DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mixing_consumption_qty_check" CHECK ((qty > (0)::numeric)),
  CONSTRAINT "mixing_consumption_pkey" PRIMARY KEY (id)
);
CREATE INDEX mixing_consumption_item_id_index ON public.mixing_consumption USING btree (item_id);
CREATE INDEX mixing_consumption_mixing_order_id_index ON public.mixing_consumption USING btree (mixing_order_id);
CREATE INDEX mixing_consumption_product_id_index ON public.mixing_consumption USING btree (product_id);

CREATE TABLE IF NOT EXISTS "mixing_order" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "mix_no" varchar(30) NOT NULL,
  "mix_date" date DEFAULT CURRENT_DATE NOT NULL,
  "formula_id" uuid NOT NULL,
  "target_qty" numeric(18,4) NOT NULL,
  "target_unit" varchar(20) NOT NULL,
  "status" varchar(20) DEFAULT 'requested'::character varying NOT NULL,
  "output_lot_id" uuid,
  "output_units" integer,
  "total_cost" numeric(18,2) DEFAULT 0 NOT NULL,
  "cost_per_unit" numeric(18,4) DEFAULT 0 NOT NULL,
  "note" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mixing_order_status_check" CHECK (((status)::text = ANY ((ARRAY['requested'::character varying, 'done'::character varying, 'cancelled'::character varying])::text[]))),
  CONSTRAINT "mixing_order_target_qty_check" CHECK ((target_qty > (0)::numeric)),
  CONSTRAINT "mixing_order_pkey" PRIMARY KEY (id),
  CONSTRAINT "mixing_order_mix_no_key" UNIQUE (mix_no)
);
CREATE INDEX mixing_order_formula_id_index ON public.mixing_order USING btree (formula_id);
CREATE INDEX mixing_order_mix_date_index ON public.mixing_order USING btree (mix_date);
CREATE INDEX mixing_order_status_index ON public.mixing_order USING btree (status);

CREATE TABLE IF NOT EXISTS "pgmigrations" (
  "id" integer DEFAULT nextval('pgmigrations_id_seq'::regclass) NOT NULL,
  "name" varchar(255) NOT NULL,
  "run_on" timestamp without time zone NOT NULL,
  CONSTRAINT "pgmigrations_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "plot" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "area_id" uuid NOT NULL,
  "plot_code" varchar(30) NOT NULL,
  "name" varchar(200) NOT NULL,
  "size" numeric(18,4),
  "size_unit" varchar(20),
  "crop" varchar(200),
  "planted_date" date,
  "status" varchar(20) DEFAULT 'preparing'::character varying NOT NULL,
  "qr_token" varchar(64) NOT NULL,
  "note" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plot_size_check" CHECK (((size IS NULL) OR (size > (0)::numeric))),
  CONSTRAINT "plot_status_check" CHECK (((status)::text = ANY ((ARRAY['preparing'::character varying, 'planted'::character varying, 'harvested'::character varying, 'resting'::character varying])::text[]))),
  CONSTRAINT "plot_pkey" PRIMARY KEY (id),
  CONSTRAINT "plot_plot_code_key" UNIQUE (plot_code),
  CONSTRAINT "plot_qr_token_key" UNIQUE (qr_token)
);
CREATE INDEX plot_area_id_index ON public.plot USING btree (area_id);
CREATE INDEX plot_status_index ON public.plot USING btree (status);

CREATE TABLE IF NOT EXISTS "plot_activity" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plot_id" uuid NOT NULL,
  "activity_date" date DEFAULT CURRENT_DATE NOT NULL,
  "activity_type" varchar(50) NOT NULL,
  "note" text,
  "total_cost" numeric(18,2) DEFAULT 0 NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plot_activity_pkey" PRIMARY KEY (id)
);
CREATE INDEX plot_activity_activity_date_index ON public.plot_activity USING btree (activity_date);
CREATE INDEX plot_activity_plot_id_index ON public.plot_activity USING btree (plot_id);

CREATE TABLE IF NOT EXISTS "plot_activity_material" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "activity_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_code" varchar(20) NOT NULL,
  "cost" numeric(18,4) DEFAULT 0 NOT NULL,
  CONSTRAINT "plot_activity_material_qty_check" CHECK ((qty > (0)::numeric)),
  CONSTRAINT "plot_activity_material_pkey" PRIMARY KEY (id)
);
CREATE INDEX plot_activity_material_activity_id_index ON public.plot_activity_material USING btree (activity_id);
CREATE INDEX plot_activity_material_product_id_index ON public.plot_activity_material USING btree (product_id);

CREATE TABLE IF NOT EXISTS "plot_harvest" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plot_id" uuid NOT NULL,
  "harvest_date" date DEFAULT CURRENT_DATE NOT NULL,
  "product_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_code" varchar(20) NOT NULL,
  "output_units" integer NOT NULL,
  "lot_id" uuid,
  "cost_total" numeric(18,2) DEFAULT 0 NOT NULL,
  "note" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plot_harvest_qty_check" CHECK ((qty > (0)::numeric)),
  CONSTRAINT "plot_harvest_units_check" CHECK ((output_units > 0)),
  CONSTRAINT "plot_harvest_pkey" PRIMARY KEY (id)
);
CREATE INDEX plot_harvest_harvest_date_index ON public.plot_harvest USING btree (harvest_date);
CREATE INDEX plot_harvest_plot_id_index ON public.plot_harvest USING btree (plot_id);

CREATE TABLE IF NOT EXISTS "plot_reading" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plot_id" uuid NOT NULL,
  "sensor_key" varchar(50) NOT NULL,
  "value" numeric(18,4) NOT NULL,
  "unit_label" varchar(30),
  "source" varchar(30) DEFAULT 'manual'::character varying NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plot_reading_pkey" PRIMARY KEY (id)
);
CREATE INDEX plot_reading_plot_id_sensor_key_recorded_at_index ON public.plot_reading USING btree (plot_id, sensor_key, recorded_at);

CREATE TABLE IF NOT EXISTS "product" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "mat_uid" varchar(50) NOT NULL,
  "name" varchar(150) NOT NULL,
  "detail" text,
  "pieces_per_lot" integer,
  "max_stock" integer DEFAULT 0 NOT NULL,
  "min_stock" integer DEFAULT 0 NOT NULL,
  "group_id" uuid,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "stock_unit" varchar(20) DEFAULT 'piece'::character varying NOT NULL,
  "pack_size" numeric(18,4),
  "pack_unit" varchar(20),
  "mat_type" varchar(20) DEFAULT 'material'::character varying NOT NULL,
  "storage_area" varchar(20),
  "is_active" boolean DEFAULT true NOT NULL,
  CONSTRAINT "product_mat_type_check" CHECK (((mat_type)::text = ANY ((ARRAY['material'::character varying, 'mixed'::character varying, 'produce'::character varying])::text[]))),
  CONSTRAINT "product_pack_size_check" CHECK (((pack_size IS NULL) OR (pack_size > (0)::numeric))),
  CONSTRAINT "product_pkey" PRIMARY KEY (id),
  CONSTRAINT "product_mat_uid_key" UNIQUE (mat_uid)
);
CREATE INDEX idx_product_group ON public.product USING btree (group_id);
CREATE INDEX idx_product_mat_uid ON public.product USING btree (mat_uid);
CREATE INDEX product_is_active_index ON public.product USING btree (is_active);
CREATE INDEX product_mat_type_index ON public.product USING btree (mat_type);

CREATE TABLE IF NOT EXISTS "product_group" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "name" varchar(100) NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_group_pkey" PRIMARY KEY (id),
  CONSTRAINT "product_group_name_key" UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS "purchase_order" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_code" varchar(30) NOT NULL,
  "order_date" date DEFAULT CURRENT_DATE NOT NULL,
  "supplier" varchar(200),
  "status" varchar(20) DEFAULT 'draft'::character varying NOT NULL,
  "total_amount" numeric(18,2) DEFAULT 0 NOT NULL,
  "note" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_order_status_check" CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'ordered'::character varying, 'partial'::character varying, 'received'::character varying, 'cancelled'::character varying])::text[]))),
  CONSTRAINT "purchase_order_pkey" PRIMARY KEY (id),
  CONSTRAINT "purchase_order_order_code_key" UNIQUE (order_code)
);
CREATE INDEX purchase_order_order_date_index ON public.purchase_order USING btree (order_date);
CREATE INDEX purchase_order_status_index ON public.purchase_order USING btree (status);

CREATE TABLE IF NOT EXISTS "purchase_order_line" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "seq" integer DEFAULT 1 NOT NULL,
  "product_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_code" varchar(20) NOT NULL,
  "unit_price" numeric(18,4) DEFAULT 0 NOT NULL,
  "total_price" numeric(18,2) DEFAULT 0 NOT NULL,
  "qty_received" numeric(18,4) DEFAULT 0 NOT NULL,
  "note" text,
  CONSTRAINT "purchase_order_line_qty_check" CHECK ((qty > (0)::numeric)),
  CONSTRAINT "purchase_order_line_qty_received_check" CHECK ((qty_received >= (0)::numeric)),
  CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY (id)
);
CREATE INDEX purchase_order_line_order_id_index ON public.purchase_order_line USING btree (order_id);
CREATE INDEX purchase_order_line_product_id_index ON public.purchase_order_line USING btree (product_id);

CREATE TABLE IF NOT EXISTS "sale" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sale_no" varchar(30) NOT NULL,
  "sale_date" date DEFAULT CURRENT_DATE NOT NULL,
  "customer" varchar(200),
  "status" varchar(20) DEFAULT 'draft'::character varying NOT NULL,
  "total_amount" numeric(18,2) DEFAULT 0 NOT NULL,
  "total_cost" numeric(18,2) DEFAULT 0 NOT NULL,
  "profit" numeric(18,2) DEFAULT 0 NOT NULL,
  "note" text,
  "created_by" uuid,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sale_status_check" CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'confirmed'::character varying, 'cancelled'::character varying])::text[]))),
  CONSTRAINT "sale_pkey" PRIMARY KEY (id),
  CONSTRAINT "sale_sale_no_key" UNIQUE (sale_no)
);
CREATE INDEX sale_sale_date_index ON public.sale USING btree (sale_date);
CREATE INDEX sale_status_index ON public.sale USING btree (status);

CREATE TABLE IF NOT EXISTS "sale_line" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sale_id" uuid NOT NULL,
  "seq" integer DEFAULT 1 NOT NULL,
  "product_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_code" varchar(20) NOT NULL,
  "unit_price" numeric(18,4) DEFAULT 0 NOT NULL,
  "total_price" numeric(18,2) DEFAULT 0 NOT NULL,
  "total_cost" numeric(18,2) DEFAULT 0 NOT NULL,
  "note" text,
  CONSTRAINT "sale_line_price_check" CHECK ((unit_price >= (0)::numeric)),
  CONSTRAINT "sale_line_qty_check" CHECK ((qty > (0)::numeric)),
  CONSTRAINT "sale_line_pkey" PRIMARY KEY (id)
);
CREATE INDEX sale_line_product_id_index ON public.sale_line USING btree (product_id);
CREATE INDEX sale_line_sale_id_index ON public.sale_line USING btree (sale_id);

CREATE TABLE IF NOT EXISTS "sale_line_item" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sale_line_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_code" varchar(20) NOT NULL,
  "cost" numeric(18,4) DEFAULT 0 NOT NULL,
  CONSTRAINT "sale_line_item_qty_check" CHECK ((qty > (0)::numeric)),
  CONSTRAINT "sale_line_item_pkey" PRIMARY KEY (id)
);
CREATE INDEX sale_line_item_item_id_index ON public.sale_line_item USING btree (item_id);
CREATE INDEX sale_line_item_sale_line_id_index ON public.sale_line_item USING btree (sale_line_id);

CREATE TABLE IF NOT EXISTS "unit" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(20) NOT NULL,
  "name" varchar(50) NOT NULL,
  "kind" varchar(10) DEFAULT 'count'::character varying NOT NULL,
  "base_code" varchar(20),
  "qty_per_base" numeric(18,6) DEFAULT 1 NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "unit_kind_check" CHECK (((kind)::text = ANY ((ARRAY['weight'::character varying, 'volume'::character varying, 'count'::character varying, 'area'::character varying])::text[]))),
  CONSTRAINT "unit_qty_per_base_check" CHECK ((qty_per_base > (0)::numeric)),
  CONSTRAINT "unit_pkey" PRIMARY KEY (id),
  CONSTRAINT "unit_code_key" UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "full_name" varchar(100) NOT NULL,
  "username" varchar(50) NOT NULL,
  "password_hash" varchar(255) NOT NULL,
  "role" varchar(10) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_login" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_role_check" CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('user'::character varying)::text]))),
  CONSTRAINT "users_pkey" PRIMARY KEY (id),
  CONSTRAINT "users_username_key" UNIQUE (username)
);

-- ─────────── Foreign key ───────────
ALTER TABLE "area" ADD CONSTRAINT "area_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "dispense" ADD CONSTRAINT "dispense_item_id_fkey" FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE RESTRICT;
ALTER TABLE "dispense" ADD CONSTRAINT "dispense_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id);
ALTER TABLE "dispense" ADD CONSTRAINT "dispense_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE "formula" ADD CONSTRAINT "formula_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "formula" ADD CONSTRAINT "formula_output_product_id_fkey" FOREIGN KEY (output_product_id) REFERENCES product(id) ON DELETE RESTRICT;
ALTER TABLE "formula" ADD CONSTRAINT "formula_output_unit_fkey" FOREIGN KEY (output_unit) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "formula_line" ADD CONSTRAINT "formula_line_formula_id_fkey" FOREIGN KEY (formula_id) REFERENCES formula(id) ON DELETE CASCADE;
ALTER TABLE "formula_line" ADD CONSTRAINT "formula_line_product_id_fkey" FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE RESTRICT;
ALTER TABLE "formula_line" ADD CONSTRAINT "formula_line_unit_code_fkey" FOREIGN KEY (unit_code) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_order_id_fkey" FOREIGN KEY (order_id) REFERENCES purchase_order(id) ON DELETE SET NULL;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES lot(id) ON DELETE RESTRICT;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_order_line_id_fkey" FOREIGN KEY (order_line_id) REFERENCES purchase_order_line(id) ON DELETE SET NULL;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_product_id_fkey" FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE RESTRICT;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_receipt_id_fkey" FOREIGN KEY (receipt_id) REFERENCES goods_receipt(id) ON DELETE CASCADE;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_unit_code_fkey" FOREIGN KEY (unit_code) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "item" ADD CONSTRAINT "item_content_unit_fkey" FOREIGN KEY (content_unit) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "item" ADD CONSTRAINT "item_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES lot(id) ON DELETE RESTRICT;
ALTER TABLE "lot" ADD CONSTRAINT "lot_product_id_fkey" FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE RESTRICT;
ALTER TABLE "mixing_consumption" ADD CONSTRAINT "mixing_consumption_item_id_fkey" FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE RESTRICT;
ALTER TABLE "mixing_consumption" ADD CONSTRAINT "mixing_consumption_mixing_order_id_fkey" FOREIGN KEY (mixing_order_id) REFERENCES mixing_order(id) ON DELETE CASCADE;
ALTER TABLE "mixing_consumption" ADD CONSTRAINT "mixing_consumption_product_id_fkey" FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE RESTRICT;
ALTER TABLE "mixing_consumption" ADD CONSTRAINT "mixing_consumption_unit_code_fkey" FOREIGN KEY (unit_code) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "mixing_order" ADD CONSTRAINT "mixing_order_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "mixing_order" ADD CONSTRAINT "mixing_order_formula_id_fkey" FOREIGN KEY (formula_id) REFERENCES formula(id) ON DELETE RESTRICT;
ALTER TABLE "mixing_order" ADD CONSTRAINT "mixing_order_output_lot_id_fkey" FOREIGN KEY (output_lot_id) REFERENCES lot(id) ON DELETE SET NULL;
ALTER TABLE "mixing_order" ADD CONSTRAINT "mixing_order_target_unit_fkey" FOREIGN KEY (target_unit) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "plot" ADD CONSTRAINT "plot_area_id_fkey" FOREIGN KEY (area_id) REFERENCES area(id) ON DELETE RESTRICT;
ALTER TABLE "plot" ADD CONSTRAINT "plot_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "plot" ADD CONSTRAINT "plot_size_unit_fkey" FOREIGN KEY (size_unit) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "plot_activity" ADD CONSTRAINT "plot_activity_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "plot_activity" ADD CONSTRAINT "plot_activity_plot_id_fkey" FOREIGN KEY (plot_id) REFERENCES plot(id) ON DELETE CASCADE;
ALTER TABLE "plot_activity_material" ADD CONSTRAINT "plot_activity_material_activity_id_fkey" FOREIGN KEY (activity_id) REFERENCES plot_activity(id) ON DELETE CASCADE;
ALTER TABLE "plot_activity_material" ADD CONSTRAINT "plot_activity_material_item_id_fkey" FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE RESTRICT;
ALTER TABLE "plot_activity_material" ADD CONSTRAINT "plot_activity_material_product_id_fkey" FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE RESTRICT;
ALTER TABLE "plot_activity_material" ADD CONSTRAINT "plot_activity_material_unit_code_fkey" FOREIGN KEY (unit_code) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "plot_harvest" ADD CONSTRAINT "plot_harvest_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "plot_harvest" ADD CONSTRAINT "plot_harvest_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES lot(id) ON DELETE SET NULL;
ALTER TABLE "plot_harvest" ADD CONSTRAINT "plot_harvest_plot_id_fkey" FOREIGN KEY (plot_id) REFERENCES plot(id) ON DELETE RESTRICT;
ALTER TABLE "plot_harvest" ADD CONSTRAINT "plot_harvest_product_id_fkey" FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE RESTRICT;
ALTER TABLE "plot_harvest" ADD CONSTRAINT "plot_harvest_unit_code_fkey" FOREIGN KEY (unit_code) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "plot_reading" ADD CONSTRAINT "plot_reading_plot_id_fkey" FOREIGN KEY (plot_id) REFERENCES plot(id) ON DELETE CASCADE;
ALTER TABLE "product" ADD CONSTRAINT "product_group_id_fkey" FOREIGN KEY (group_id) REFERENCES product_group(id) ON DELETE SET NULL;
ALTER TABLE "product" ADD CONSTRAINT "product_pack_unit_fkey" FOREIGN KEY (pack_unit) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "product" ADD CONSTRAINT "product_stock_unit_fkey" FOREIGN KEY (stock_unit) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_order_id_fkey" FOREIGN KEY (order_id) REFERENCES purchase_order(id) ON DELETE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_product_id_fkey" FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE RESTRICT;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_unit_code_fkey" FOREIGN KEY (unit_code) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "sale" ADD CONSTRAINT "sale_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_product_id_fkey" FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE RESTRICT;
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sale(id) ON DELETE CASCADE;
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_unit_code_fkey" FOREIGN KEY (unit_code) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_item_id_fkey" FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE RESTRICT;
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_sale_line_id_fkey" FOREIGN KEY (sale_line_id) REFERENCES sale_line(id) ON DELETE CASCADE;
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_unit_code_fkey" FOREIGN KEY (unit_code) REFERENCES unit(code) ON DELETE RESTRICT;
ALTER TABLE "unit" ADD CONSTRAINT "unit_base_code_fkey" FOREIGN KEY (base_code) REFERENCES unit(code) ON DELETE RESTRICT;

-- ─────────── ฟังก์ชัน ───────────

CREATE OR REPLACE FUNCTION public.auto_expire_lots()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE lot SET status = 'expired', updated_at = NOW()
  WHERE exp_date < CURRENT_DATE AND status = 'active';

  UPDATE item SET status = 'expired'
  WHERE lot_id IN (SELECT id FROM lot WHERE status = 'expired')
  AND status = 'active';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_ave_cost(p_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total_value  NUMERIC;
  v_total_qty    INT;
  v_new_ave_cost NUMERIC;
BEGIN
  SELECT COALESCE(SUM(qty_remaining * cost), 0), COALESCE(SUM(qty_remaining), 0)
  INTO v_total_value, v_total_qty
  FROM lot WHERE product_id = p_product_id AND status = 'active';

  IF v_total_qty > 0 THEN
    v_new_ave_cost := ROUND(v_total_value / v_total_qty, 2);
  ELSE
    v_new_ave_cost := 0;
  END IF;

  UPDATE lot SET ave_cost = v_new_ave_cost, updated_at = NOW()
  WHERE product_id = p_product_id AND status = 'active';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

-- ─────────── View ───────────

CREATE OR REPLACE VIEW "v_lot_detail" AS
SELECT l.id,
    l.lot_no,
    l.product_id,
    p.mat_uid,
    p.name AS product_name,
    pg.name AS group_name,
    l.qty_received,
    l.qty_remaining,
    l.cost,
    l.ave_cost,
    l.mfg_date,
    l.exp_date,
    l.shelf_life_days,
    (l.exp_date - CURRENT_DATE) AS days_remaining,
        CASE
            WHEN ((l.exp_date - CURRENT_DATE) < 0) THEN 'expired'::text
            WHEN ((l.exp_date - CURRENT_DATE) < 15) THEN 'critical'::text
            WHEN ((l.exp_date - CURRENT_DATE) <= 60) THEN 'warning'::text
            ELSE 'ok'::text
        END AS exp_status,
    l.supplier,
    l.status,
    l.created_at
   FROM ((lot l
     JOIN product p ON ((l.product_id = p.id)))
     LEFT JOIN product_group pg ON ((p.group_id = pg.id)));

CREATE OR REPLACE VIEW "v_stock_summary" AS
SELECT p.id AS product_id,
    p.mat_uid,
    p.name,
    p.detail,
    p.pieces_per_lot,
    p.max_stock,
    p.min_stock,
    pg.name AS group_name,
    COALESCE(sum(l.qty_remaining), (0)::bigint) AS total_stock,
        CASE
            WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) = 0) THEN 'out'::text
            WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) <= p.min_stock) THEN 'low'::text
            WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) >= p.max_stock) THEN 'full'::text
            ELSE 'ok'::text
        END AS stock_status,
    round(
        CASE
            WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) = 0) THEN (0)::numeric
            ELSE (sum(((l.qty_remaining)::numeric * l.cost)) / (sum(l.qty_remaining))::numeric)
        END, 2) AS ave_cost
   FROM ((product p
     LEFT JOIN product_group pg ON ((p.group_id = pg.id)))
     LEFT JOIN lot l ON (((l.product_id = p.id) AND ((l.status)::text = 'active'::text))))
  GROUP BY p.id, p.mat_uid, p.name, p.detail, p.pieces_per_lot, p.max_stock, p.min_stock, pg.name;

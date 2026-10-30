-- Product pictures reach the location hubs (ADR 0027): `product_images` joins the snapshot, so
-- a picture added, reordered or removed on its own is a configuration change like any other.
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON product_images
  FOR EACH ROW EXECUTE FUNCTION record_config_change('product');

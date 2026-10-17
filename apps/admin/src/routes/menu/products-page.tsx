import { pickLocalized } from '@pos/i18n';
import type { Product } from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Input,
  Label,
  NativeSelect,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { Pencil, Plus, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveAction } from '../../components/archive-action';
import { QueryState } from '@pos/app-kit';
import { ArchivedBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { useCurrentLocale } from '@pos/app-kit';
import { useMoney } from '../../lib/money';
import { usePermissions } from '../../lib/permissions';
import {
  useCatalogMutation,
  useCategories,
  useKitchenStations,
  useModifierGroups,
  useProducts,
  useRestaurantId,
  useTaxes,
} from '../../lib/queries';
import { ProductDialog } from './product-dialog';

export function ProductsPage() {
  const { t } = useTranslation(['menu', 'common']);
  const locale = useCurrentLocale();
  const rid = useRestaurantId();
  const { can } = usePermissions();
  const { currency, format } = useMoney();
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const deferredSearch = useDeferredValue(search.trim());

  const categories = useCategories();
  const groups = useModifierGroups();
  const stations = useKitchenStations();
  const taxes = useTaxes();
  const products = useProducts({
    ...(categoryId ? { categoryId } : {}),
    ...(deferredSearch ? { search: deferredSearch } : {}),
    ...(showArchived ? { includeArchived: 'true' as const } : {}),
  });
  const archive = useCatalogMutation((id: string) => api.menu.products.archive(rid, id));
  const restore = useCatalogMutation((id: string) => api.menu.products.restore(rid, id));

  const categoryName = useMemo(() => {
    const map = new Map(
      (categories.data ?? []).map((c) => [c.id, pickLocalized(c, 'name', locale)]),
    );
    return (id: string) => map.get(id) ?? '';
  }, [categories.data, locale]);
  const stationName = useMemo(() => {
    const map = new Map((stations.data ?? []).map((s) => [s.id, pickLocalized(s, 'name', locale)]));
    return (id: string) => map.get(id);
  }, [stations.data, locale]);

  const hasCategories = (categories.data?.length ?? 0) > 0;
  const formReady = Boolean(
    currency && categories.data && groups.data && stations.data && taxes.data,
  );

  return (
    <>
      <PageHeader
        title={t('menu:products.title')}
        description={t('menu:products.description')}
        actions={
          can('products.create') ? (
            <Button
              disabled={!formReady || !hasCategories}
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('menu:products.new')}
            </Button>
          ) : null
        }
      />
      {categories.data && !hasCategories ? (
        <Alert className="mb-4">{t('menu:products.needCategory')}</Alert>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            className="ps-9"
            aria-label={t('menu:products.search')}
            placeholder={t('menu:products.search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>
        <NativeSelect
          aria-label={t('menu:products.category')}
          className="w-auto"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
          }}
        >
          <option value="">{t('menu:products.allCategories')}</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {pickLocalized(c, 'name', locale)}
            </option>
          ))}
        </NativeSelect>
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-archived"
            checked={showArchived}
            onCheckedChange={(v) => {
              setShowArchived(v === true);
            }}
          />
          <Label htmlFor="show-archived">{t('menu:showArchived')}</Label>
        </div>
      </div>
      <QueryState
        query={products}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('menu:products.empty'), description: t('menu:products.emptyHint') }}
      >
        {(rows) => (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('menu:fields.name')}</TableHead>
                  <TableHead>{t('menu:products.category')}</TableHead>
                  <TableHead className="w-36">{t('menu:products.price')}</TableHead>
                  <TableHead>{t('menu:products.stations')}</TableHead>
                  <TableHead className="w-28">{t('menu:fields.status')}</TableHead>
                  <TableHead className="w-56 text-end">{t('menu:fields.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const minVariant =
                    row.variants.length > 0 ? Math.min(...row.variants.map((v) => v.price)) : null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{pickLocalized(row, 'name', locale)}</div>
                        {row.sku ? (
                          <div className="ltr-nums whitespace-nowrap font-mono text-xs text-muted-foreground">
                            {row.sku}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>{categoryName(row.categoryId)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {minVariant !== null
                          ? t('menu:products.fromPrice', { price: format(minVariant) })
                          : format(row.price)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {row.stationIds.map((id) => {
                            const name = stationName(id);
                            return name ? (
                              <Badge key={id} variant="outline">
                                {name}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ArchivedBadge archivedAt={row.archivedAt} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {can('products.update') && !row.archivedAt ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!formReady}
                              onClick={() => {
                                setEditing(row);
                              }}
                            >
                              <Pencil aria-hidden />
                              {t('common:actions.edit')}
                            </Button>
                          ) : null}
                          <ArchiveAction
                            name={pickLocalized(row, 'name', locale)}
                            archived={row.archivedAt !== null}
                            canArchive={can('products.delete')}
                            canRestore={can('products.update')}
                            pending={archive.isPending || restore.isPending}
                            onArchive={() => archive.mutateAsync(row.id)}
                            onRestore={() => restore.mutateAsync(row.id)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </QueryState>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null &&
        currency &&
        categories.data &&
        groups.data &&
        stations.data &&
        taxes.data ? (
          <ProductDialog
            key={editing === 'new' ? 'new' : editing.id}
            product={editing === 'new' ? null : editing}
            currency={currency}
            categories={categories.data}
            modifierGroups={groups.data}
            stations={stations.data}
            taxes={taxes.data}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

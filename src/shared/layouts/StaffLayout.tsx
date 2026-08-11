import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { StaffShell } from './StaffShell';

export interface StaffOutletContext {
  search: string;
  setSearch: (search: string) => void;
}

export function StaffLayout() {
  const [search, setSearch] = useState('');

  return (
    <StaffShell search={search} setSearch={setSearch}>
      <Outlet context={{ search, setSearch } satisfies StaffOutletContext} />
    </StaffShell>
  );
}

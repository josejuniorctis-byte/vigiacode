export interface Customer {
  id: number;
  customerName: string;
  email: string;
}

export const customersMock: Customer[] = [{ id: 1, customerName: 'Ana', email: 'ana@example.com' }];

import { customersMock } from '../mocks/customers';

export function CustomersPage() {
  // Tela "só local": usa mock + localStorage e nunca chama a API.
  localStorage.setItem('customers', JSON.stringify(customersMock));

  return (
    <ul>
      {customersMock.map((customer) => (
        <li key={customer.id}>{customer.customerName}</li>
      ))}
    </ul>
  );
}

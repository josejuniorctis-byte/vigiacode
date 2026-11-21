package com.example.products;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "products")
public class Product {
  @Id
  private Long id;

  @Column(name = "name")
  private String name;

  @Column(name = "price")
  private java.math.BigDecimal price;

  @Column(name = "stock")
  private Integer stock;
}

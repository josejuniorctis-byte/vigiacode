package com.example.products;

public record ProductDto(
    Long id,
    String name,
    double price,
    Integer stock,
    String description
) {}
